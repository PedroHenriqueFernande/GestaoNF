import { ConflictException, ForbiddenException, GoneException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { accounts, accountSubscriptions, companies, companyUsers, emailMessages, userCredentials, userInvitations, userInvitationCompanies, userManagementCommands, userManagementEvents, users, whatsappLinkCompanies, whatsappRequests, whatsappOutboundMessages, whatsappLinkChallenges, whatsappConsentEvents } from '@gestaonf/database/schema';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService } from '../database/database.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import type { AccountTx } from '../accounts/account-policy.js';
import { AuthService } from '../auth/auth.service.js';
import { EmailsService } from '../emails/emails.service.js';
import type { createInvitationSchema, userListSchema } from './users.schemas.js';

type Invitation = typeof userInvitations.$inferSelect;
const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
function conflict(code: string, extra: Record<string, unknown> = {}) { return new ConflictException({ message: code, code, ...extra }); }
function publicInvitation(i: Invitation) { return { id: i.id, type: 'INVITATION', name: i.invitedName, email: i.emailNormalized, status: i.status === 'PENDING' && i.expiresAt <= new Date() ? 'EXPIRED' : i.status, expiresAt: i.expiresAt, version: i.version, createdAt: i.createdAt }; }

@Injectable()
export class UsersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AccountsService) private readonly accountService: AccountsService, @Inject(EmailsService) private readonly emails: EmailsService, @Inject(AuthService) private readonly auth: AuthService) {}

  private async selected(tx: AccountTx, accountId: string, companyIds: string[]) {
    if (!companyIds.length) return [];
    const rows = await tx.select().from(companies).where(and(eq(companies.accountId, accountId), inArray(companies.id, companyIds))).orderBy(asc(companies.id)).for('update');
    if (rows.length !== companyIds.length || rows.some(c => c.status !== 'ACTIVE')) throw new NotFoundException('Empresas selecionadas não disponíveis nesta contratação');
    return rows;
  }
  async capacity(accountId: string, actor: string) {
    await this.accountService.owner(accountId, actor);
    return this.database.db.transaction(tx => this.capacityInTx(tx, accountId));
  }
  private async capacityInTx(tx: AccountTx, accountId: string, excludeInvitation?: string) {
    const rows = await tx.execute(sql`
      select c.id as "companyId", c.name, c.status, s.additional_users_per_company as "limit",
      (select count(*)::int from company_users cu where cu.company_id=c.id and cu.status='ACTIVE' and cu.user_id<>a.owner_user_id) as occupied,
      (select count(distinct i.email_normalized)::int from user_invitations i join user_invitation_companies ic on ic.invitation_id=i.id
       where ic.company_id=c.id and i.status='PENDING' and i.expires_at>now() and (${excludeInvitation ?? null}::uuid is null or i.id<>${excludeInvitation ?? null}::uuid)
       and not exists(select 1 from company_users cu join users u on u.id=cu.user_id where cu.company_id=c.id and cu.status='ACTIVE' and u.email=i.email_normalized)) as reserved
      from companies c join accounts a on a.id=c.account_id join account_subscriptions s on s.account_id=a.id
      where c.account_id=${accountId} order by c.name,c.id`);
    return rows.map(r => { const occupied = Number(r.occupied), reserved = Number(r.reserved), limit = Number(r.limit); return { companyId: String(r.companyId), name: String(r.name), status: String(r.status), limit, occupied, reserved, available: Math.max(0, limit - occupied - reserved), overLimit: Math.max(0, occupied + reserved - limit), ownerIncludedSeparately: true }; });
  }
  private async checkSpace(tx: AccountTx, accountId: string, companyIds: string[], email: string, excludeInvitation?: string) {
    const rows = await this.capacityInTx(tx, accountId, excludeInvitation);
    const active = await tx.select({ companyId: companyUsers.companyId }).from(companyUsers).innerJoin(users, eq(users.id, companyUsers.userId)).where(and(inArray(companyUsers.companyId, companyIds), eq(users.email, email), eq(companyUsers.status, 'ACTIVE')));
    const already = new Set(active.map(r => r.companyId));
    const full = rows.filter(r => companyIds.includes(r.companyId) && !already.has(r.companyId) && r.available <= 0);
    if (full.length) throw conflict('COMPANY_USER_LIMIT_REACHED', { companies: full.map(c => ({ id: c.companyId, name: c.name })) });
    return already;
  }
  private async event(tx: AccountTx, accountId: string, actor: string | null, type: string, details: { invitationId?: string; targetUserId?: string; companyId?: string; changes?: Record<string, unknown> } = {}) {
    await tx.insert(userManagementEvents).values({ accountId, actorUserId: actor, eventType: type, ...details });
  }
  private async cancelEmails(tx: AccountTx, invitationId: string) {
    await tx.update(emailMessages).set({ sendStatus: 'CANCELED', encryptedPayload: null, encryptionKeyId: null, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(and(eq(emailMessages.invitationId, invitationId), inArray(emailMessages.sendStatus, ['QUEUED', 'RETRYING', 'SENDING'])));
    await tx.update(emailMessages).set({ encryptedPayload: null, encryptionKeyId: null }).where(and(eq(emailMessages.invitationId, invitationId), inArray(emailMessages.sendStatus, ['FAILED', 'UNKNOWN', 'ACCEPTED', 'CANCELED'])));
  }
  private async expireInTx(tx: AccountTx, accountId: string) {
    const expired = await tx.update(userInvitations).set({ status: 'EXPIRED', updatedAt: new Date() }).where(and(eq(userInvitations.accountId, accountId), eq(userInvitations.status, 'PENDING'), lte(userInvitations.expiresAt, new Date()))).returning();
    for (const i of expired) { await this.cancelEmails(tx, i.id); await this.event(tx, accountId, null, 'INVITATION_EXPIRED', { invitationId: i.id }); }
  }
  private command(accountId: string, actor: string, key: string, operation: string, input: unknown, action: (tx: AccountTx, account: Awaited<ReturnType<AccountsService['owner']>>) => Promise<Record<string, unknown>>, requireActive = true) {
    return this.database.db.transaction(async tx => {
      const account = await this.accountService.owner(accountId, actor, tx, true, false);
      const requestHash = hash({ operation, input });
      const [previous] = await tx.select().from(userManagementCommands).where(and(eq(userManagementCommands.accountId, accountId), eq(userManagementCommands.actorUserId, actor), eq(userManagementCommands.requestKey, key)));
      if (previous) { if (previous.requestHash !== requestHash) throw conflict('IDEMPOTENCY_CONFLICT'); return previous.result; }
      if (requireActive) await this.accountService.owner(accountId, actor, tx, false, true);
      await this.expireInTx(tx, accountId);
      const result = await action(tx, account);
      await tx.insert(userManagementCommands).values({ accountId, actorUserId: actor, requestKey: key, requestHash, operation, result });
      return result;
    });
  }
  async inviteDetails(tx: AccountTx, invitation: Invitation) {
    const destinations = await tx.select({ id: companies.id, name: companies.name }).from(userInvitationCompanies).innerJoin(companies, eq(companies.id, userInvitationCompanies.companyId)).where(eq(userInvitationCompanies.invitationId, invitation.id)).orderBy(asc(companies.id));
    const [mail] = await tx.select({ id: emailMessages.id, sendStatus: emailMessages.sendStatus }).from(emailMessages).where(and(eq(emailMessages.invitationId, invitation.id), eq(emailMessages.invitationVersion, invitation.version))).orderBy(desc(emailMessages.createdAt)).limit(1);
    return { ...publicInvitation(invitation), companies: destinations, email: invitation.emailNormalized, delivery: mail ?? null };
  }
  create(accountId: string, actor: string, input: z.output<typeof createInvitationSchema>, key: string) {
    return this.command(accountId, actor, key, 'INVITE', input, async (tx, { account }) => {
      const destinations = await this.selected(tx, accountId, input.companyIds);
      const [owner] = await tx.select({ email: users.email }).from(users).where(eq(users.id, account.ownerUserId));
      if (owner.email === input.email) throw conflict('OWNER_PROTECTED');
      const [pending] = await tx.select().from(userInvitations).where(and(eq(userInvitations.accountId, accountId), eq(userInvitations.emailNormalized, input.email), eq(userInvitations.status, 'PENDING')));
      if (pending) throw conflict('INVITATION_ALREADY_PENDING');
      const already = await this.checkSpace(tx, accountId, input.companyIds, input.email);
      if (already.size === input.companyIds.length) throw conflict('USER_ALREADY_LINKED');
      const token = randomBytes(32).toString('base64url');
      const [invite] = await tx.insert(userInvitations).values({ accountId, createdByUserId: actor, invitedName: input.name, emailNormalized: input.email, tokenHash: hash(token), expiresAt: new Date(Date.now() + 86400_000), lastSentAt: new Date() }).returning();
      await tx.insert(userInvitationCompanies).values(destinations.map(c => ({ invitationId: invite.id, accountId, companyId: c.id })));
      await this.send(tx, invite, account.name, destinations, token);
      await this.event(tx, accountId, actor, 'INVITATION_CREATED', { invitationId: invite.id, changes: { companyIds: input.companyIds } });
      return this.inviteDetails(tx, invite);
    });
  }
  private send(tx: AccountTx, invite: Invitation, accountName: string, destinations: { id: string; name: string }[], token: string) {
    return this.emails.enqueueInvitationInTx(tx, { companyId: destinations[0].id, userId: invite.createdByUserId }, { id: invite.id, version: invite.version, email: invite.emailNormalized, name: invite.invitedName, accountName, companies: destinations.map(c => c.name) }, token);
  }
  private async invitation(tx: AccountTx, accountId: string, id: string, version: number) {
    const [invite] = await tx.select().from(userInvitations).where(and(eq(userInvitations.id, id), eq(userInvitations.accountId, accountId))).for('update');
    if (!invite) throw new NotFoundException('Convite não encontrado');
    if (invite.version !== version) throw conflict('VERSION_CONFLICT');
    return invite;
  }
  rotate(accountId: string, actor: string, id: string, version: number, key: string, companyIds?: string[]) {
    return this.command(accountId, actor, key, companyIds ? 'INVITE_COMPANIES' : 'RESEND', { id, version, companyIds }, async (tx, { account }) => {
      const invite = await this.invitation(tx, accountId, id, version);
      if (invite.status !== 'PENDING') throw new GoneException('Convite não está pendente');
      const today = new Date().toISOString().slice(0, 10), count = invite.resendDay === today ? invite.resendCount : 0;
      if ((invite.lastSentAt && Date.now() - invite.lastSentAt.getTime() < 60_000) || count >= 5) throw new HttpException('Aguarde antes de reenviar o convite', 429);
      const current = await tx.select({ id: userInvitationCompanies.companyId }).from(userInvitationCompanies).where(eq(userInvitationCompanies.invitationId, id));
      const selection = companyIds ?? current.map(c => c.id).sort();
      const destinations = await this.selected(tx, accountId, selection);
      await this.checkSpace(tx, accountId, selection, invite.emailNormalized, id);
      await this.cancelEmails(tx, id);
      if (companyIds) {
        // Preserve historical destination rows used by membership FKs; a pending invitation has not granted access.
        await tx.delete(userInvitationCompanies).where(eq(userInvitationCompanies.invitationId, id));
        await tx.insert(userInvitationCompanies).values(destinations.map(c => ({ invitationId: id, accountId, companyId: c.id })));
      }
      const token = randomBytes(32).toString('base64url');
      const [updated] = await tx.update(userInvitations).set({ tokenHash: hash(token), version: version + 1, expiresAt: new Date(Date.now() + 86400_000), lastSentAt: new Date(), resendCount: count + 1, resendDay: today, updatedAt: new Date() }).where(eq(userInvitations.id, id)).returning();
      await this.send(tx, updated, account.name, destinations, token);
      await this.event(tx, accountId, actor, companyIds ? 'INVITATION_COMPANIES_CHANGED' : 'INVITATION_RESENT', { invitationId: id, changes: { version: updated.version, companyIds: selection } });
      return this.inviteDetails(tx, updated);
    });
  }
  revoke(accountId: string, actor: string, id: string, version: number, key: string) {
    return this.command(accountId, actor, key, 'REVOKE', { id, version }, async tx => {
      const invite = await this.invitation(tx, accountId, id, version);
      if (invite.status === 'ACCEPTED') throw conflict('INVITATION_ALREADY_ACCEPTED');
      if (invite.status === 'PENDING') {
        await tx.update(userInvitations).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() }).where(eq(userInvitations.id, id));
        await this.cancelEmails(tx, id); await this.event(tx, accountId, actor, 'INVITATION_REVOKED', { invitationId: id });
      }
      const [updated] = await tx.select().from(userInvitations).where(eq(userInvitations.id, id)); return this.inviteDetails(tx, updated);
    }, false);
  }
  private async lookup(token: string) {
    const [invite] = await this.database.db.select().from(userInvitations).where(eq(userInvitations.tokenHash, hash(token))).limit(1);
    if (!invite) throw new GoneException('Convite inválido ou expirado');
    return invite;
  }
  private async lockToken(tx: AccountTx, original: Invitation, token: string) {
    const account = await this.accountService.owner(original.accountId, original.createdByUserId, tx, true, true);
    const [invite] = await tx.select().from(userInvitations).where(and(eq(userInvitations.id, original.id), eq(userInvitations.tokenHash, hash(token)))).for('update');
    if (!invite || invite.status !== 'PENDING' || invite.expiresAt <= new Date()) throw new GoneException('Convite inválido ou expirado');
    const target = await tx.select({ companyId: userInvitationCompanies.companyId }).from(userInvitationCompanies).where(eq(userInvitationCompanies.invitationId, invite.id));
    if (!target.length) throw new GoneException('Convite inválido');
    const destinations = await this.selected(tx, invite.accountId, target.map(c => c.companyId).sort());
    await this.checkSpace(tx, invite.accountId, destinations.map(c => c.id), invite.emailNormalized, invite.id);
    return { invite, destinations, account };
  }
  async preview(token: string) {
    const original = await this.lookup(token);
    return this.database.db.transaction(async tx => {
      const { invite, destinations, account } = await this.lockToken(tx, original, token);
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, invite.emailNormalized));
      const [local, domain] = invite.emailNormalized.split('@');
      return { invitationId: invite.id, name: invite.invitedName, accountName: account.account.name, email: `${local[0]}***@${domain}`, companies: destinations.map(c => ({ id: c.id, name: c.name })), expiresAt: invite.expiresAt, nextStep: existing ? 'LOGIN' : 'DEFINE_PASSWORD' };
    });
  }
  async acceptNew(token: string, password: string) {
    const original = await this.lookup(token);
    if (original.status !== 'PENDING' || original.expiresAt <= new Date()) throw new GoneException('Convite inválido ou expirado');
    const passwordHash = await this.auth.hashPassword(password);
    return this.database.db.transaction(async tx => {
      const { invite, destinations } = await this.lockToken(tx, original, token);
      const [created] = await tx.insert(users).values({ name: invite.invitedName, email: invite.emailNormalized, emailVerifiedAt: new Date() }).onConflictDoNothing().returning();
      if (!created) throw conflict('LOGIN_REQUIRED');
      await tx.insert(userCredentials).values({ userId: created.id, passwordHash });
      await this.grant(tx, invite, created.id, destinations.map(c => c.id));
      return { user: { id: created.id, name: created.name, email: created.email }, companies: destinations.map(c => ({ id: c.id, name: c.name })), ...(await this.auth.issueTokens(created.id, tx)) };
    });
  }
  async acceptExisting(token: string, userId: string) {
    const original = await this.lookup(token);
    return this.database.db.transaction(async tx => {
      if (original.status === 'ACCEPTED' && original.acceptedByUserId === userId) return { accepted: true, invitationId: original.id };
      const { invite, destinations } = await this.lockToken(tx, original, token);
      const [user] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.status, 'ACTIVE'))).for('share');
      if (!user || user.email !== invite.emailNormalized) throw new ForbiddenException({ message: 'Use a conta do e-mail convidado', code: 'INVITATION_EMAIL_MISMATCH' });
      const [credential] = await tx.select().from(userCredentials).where(eq(userCredentials.userId, userId));
      if (!credential) throw conflict('LOGIN_REQUIRED');
      await this.grant(tx, invite, userId, destinations.map(c => c.id));
      return { accepted: true, invitationId: invite.id, companies: destinations.map(c => ({ id: c.id, name: c.name })) };
    });
  }
  private async grant(tx: AccountTx, invite: Invitation, userId: string, companyIds: string[]) {
    for (const companyId of companyIds) {
      const [existing] = await tx.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId))).for('update');
      if (!existing) await tx.insert(companyUsers).values({ companyId, userId, role: 'COLLABORATOR', joinedViaInvitationId: invite.id });
      else if (existing.status !== 'ACTIVE') await tx.update(companyUsers).set({ status: 'ACTIVE', role: 'COLLABORATOR', version: existing.version + 1, joinedViaInvitationId: invite.id, updatedAt: new Date() }).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)));
    }
    await tx.update(users).set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt},now())` }).where(eq(users.id, userId));
    await tx.update(userInvitations).set({ status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: userId, updatedAt: new Date() }).where(eq(userInvitations.id, invite.id));
    await this.cancelEmails(tx, invite.id);
    await this.event(tx, invite.accountId, userId, 'INVITATION_ACCEPTED', { invitationId: invite.id, targetUserId: userId, changes: { companyIds } });
  }
  private async memberRows(tx: AccountTx, accountId: string, userId: string) {
    return tx.select({ companyId: companyUsers.companyId, companyName: companies.name, status: companyUsers.status, role: companyUsers.role, version: companyUsers.version }).from(companyUsers).innerJoin(companies, eq(companies.id, companyUsers.companyId)).where(and(eq(companies.accountId, accountId), eq(companyUsers.userId, userId))).orderBy(asc(companyUsers.companyId));
  }
  private memberVersion(rows: Awaited<ReturnType<UsersService['memberRows']>>) { return hash(rows.map(r => ({ companyId: r.companyId, status: r.status, role: r.role, version: r.version }))); }
  updateCompanies(accountId: string, actor: string, userId: string, companyIds: string[], version: string, key: string) {
    return this.command(accountId, actor, key, 'MEMBER_COMPANIES', { userId, companyIds, version }, async (tx, { account }) => {
      if (userId === account.ownerUserId) throw conflict('OWNER_PROTECTED');
      const before = await this.memberRows(tx, accountId, userId);
      if (!before.length) throw new NotFoundException('Usuário não vinculado à contratação');
      if (this.memberVersion(before) !== version) throw conflict('VERSION_CONFLICT');
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      const selected = await this.selected(tx, accountId, companyIds);
      const pending = await tx.select().from(userInvitations).where(and(eq(userInvitations.accountId, accountId), eq(userInvitations.emailNormalized, user.email), eq(userInvitations.status, 'PENDING')));
      for (const i of pending) { await tx.update(userInvitations).set({ status: 'REVOKED', revokedAt: new Date() }).where(eq(userInvitations.id, i.id)); await this.cancelEmails(tx, i.id); await this.event(tx, accountId, actor, 'INVITATION_REVOKED', { invitationId: i.id }); }
      const added = selected.filter(c => !before.some(r => r.companyId === c.id && r.status === 'ACTIVE'));
      if (added.length && user.status !== 'ACTIVE') throw new ForbiddenException('Usuário global indisponível');
      if (added.length) { await this.accountService.owner(accountId, actor, tx, false, true); await this.checkSpace(tx, accountId, added.map(c => c.id), user.email); }
      for (const c of selected) {
        const existing = before.find(r => r.companyId === c.id);
        if (!existing) await tx.insert(companyUsers).values({ companyId: c.id, userId, role: 'COLLABORATOR' });
        else if (existing.status !== 'ACTIVE') await tx.update(companyUsers).set({ status: 'ACTIVE', role: 'COLLABORATOR', version: existing.version + 1, updatedAt: new Date() }).where(and(eq(companyUsers.companyId, c.id), eq(companyUsers.userId, userId)));
      }
      const removed = before.filter(r => r.status === 'ACTIVE' && !companyIds.includes(r.companyId));
      for (const r of removed) {
        await tx.update(companyUsers).set({ status: 'INACTIVE', version: r.version + 1, updatedAt: new Date() }).where(and(eq(companyUsers.companyId, r.companyId), eq(companyUsers.userId, userId)));
        await this.revokeNero(tx, r.companyId, userId, actor);
      }
      await this.event(tx, accountId, actor, 'MEMBER_COMPANIES_CHANGED', { targetUserId: userId, changes: { added: added.map(c => c.id), removed: removed.map(c => c.companyId) } });
      const memberships = await this.memberRows(tx, accountId, userId);
      return { userId, companies: memberships, version: this.memberVersion(memberships) };
    }, false);
  }
  private async revokeNero(tx: AccountTx, companyId: string, userId: string, actor: string) {
    const associations = await tx.update(whatsappLinkCompanies).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(whatsappLinkCompanies.companyId, companyId), eq(whatsappLinkCompanies.userId, userId), eq(whatsappLinkCompanies.status, 'ACTIVE'))).returning();
    for (const a of associations) await tx.insert(whatsappConsentEvents).values({ linkId: a.linkId, companyLinkId: a.id, actorUserId: actor, event: 'REVOKED', source: 'ADMIN' });
    await tx.update(whatsappRequests).set({ status: 'CANCELED', updatedAt: new Date() }).where(and(eq(whatsappRequests.companyId, companyId), eq(whatsappRequests.userId, userId), inArray(whatsappRequests.status, ['AWAITING_REPLY', 'READY', 'PROCESSING'])));
    await tx.update(whatsappLinkChallenges).set({ status: 'CANCELED', updatedAt: new Date() }).where(and(eq(whatsappLinkChallenges.companyId, companyId), eq(whatsappLinkChallenges.userId, userId), inArray(whatsappLinkChallenges.status, ['PENDING', 'CANDIDATE'])));
    if (associations.length) await tx.update(whatsappOutboundMessages).set({ status: 'CANCELED', failureReason: 'Acesso à empresa removido', updatedAt: new Date() }).where(and(inArray(whatsappOutboundMessages.companyLinkId, associations.map(a => a.id)), inArray(whatsappOutboundMessages.status, ['QUEUED', 'SENDING'])));
  }
  async list(accountId: string, actor: string, input: z.output<typeof userListSchema>) {
    const { account } = await this.accountService.owner(accountId, actor);
    return this.database.db.transaction(async tx => {
      const ids = await tx.selectDistinct({ id: users.id, name: users.name, email: users.email }).from(companyUsers).innerJoin(companies, eq(companies.id, companyUsers.companyId)).innerJoin(users, eq(users.id, companyUsers.userId)).where(eq(companies.accountId, accountId));
      if (!ids.some(u => u.id === account.ownerUserId)) {
        const [owner] = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, account.ownerUserId));
        ids.push(owner);
      }
      const members = [];
      for (const user of ids) { const bindings = await this.memberRows(tx, accountId, user.id); members.push({ ...user, type: 'MEMBER', status: user.id === account.ownerUserId ? 'OWNER' : bindings.some(r => r.status === 'ACTIVE') ? 'ACTIVE' : 'INACTIVE', companies: bindings, version: this.memberVersion(bindings) }); }
      const invites = await tx.select().from(userInvitations).where(and(eq(userInvitations.accountId, accountId), ne(userInvitations.status, 'ACCEPTED'))).orderBy(desc(userInvitations.createdAt));
      const invitations = await Promise.all(invites.map(i => this.inviteDetails(tx, i)));
      const query = input.search.toLowerCase();
      const all = [...members, ...invitations].filter(r => !query || `${r.name} ${r.email}`.toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name));
      return { items: all.slice(input.offset, input.offset + input.limit), total: all.length };
    });
  }
  async expireDue() {
    const candidates = await this.database.db.selectDistinct({ accountId: userInvitations.accountId }).from(userInvitations).where(and(eq(userInvitations.status, 'PENDING'), lte(userInvitations.expiresAt, new Date()))).limit(50);
    for (const c of candidates) await this.database.db.transaction(async tx => { await tx.select().from(accounts).where(eq(accounts.id, c.accountId)).for('update'); await this.expireInTx(tx, c.accountId); });
  }
}
