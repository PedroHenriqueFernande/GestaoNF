import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { accounts, accountSubscriptions, userManagementEvents, users } from '@gestaonf/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.module.js';
import type { AccountTx, AccountDb } from './account-policy.js';
import { userManagementCommands } from '@gestaonf/database/schema';
import { z } from 'zod';

export function localAccountActivationAllowed() { return process.env.NODE_ENV !== 'production' && process.env.ACCOUNTS_ALLOW_LOCAL_ACTIVATION === 'true'; }
@Injectable()
export class AccountsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async owner(accountId: string, userId: string, db: AccountDb = this.database.db, lock = false, requireActive = false) {
    const query = db.select({ account: accounts, subscription: accountSubscriptions }).from(accounts).innerJoin(accountSubscriptions, eq(accountSubscriptions.accountId, accounts.id)).innerJoin(users, eq(users.id, accounts.ownerUserId)).where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, userId), eq(users.status, 'ACTIVE'))).limit(1);
    const [row] = await (lock ? query.for('update', { of: [accounts, accountSubscriptions] }) : query);
    if (!row) throw new NotFoundException('Contratação não encontrada');
    if (requireActive && (row.account.status !== 'ACTIVE' || row.subscription.status !== 'ACTIVE' || (row.subscription.source !== 'LEGACY_DEV' && (!row.subscription.currentPeriodEndsAt || row.subscription.currentPeriodEndsAt <= new Date())))) throw new ForbiddenException('Contratação não habilitada');
    return row;
  }
  list(userId: string) { return this.database.db.select({ id: accounts.id, name: accounts.name, status: accounts.status, planCode: accountSubscriptions.planCode, additionalUsersPerCompany: accountSubscriptions.additionalUsersPerCompany }).from(accounts).innerJoin(accountSubscriptions, eq(accountSubscriptions.accountId, accounts.id)).where(eq(accounts.ownerUserId, userId)); }
  create(userId: string, name: string, key: string) { return this.database.db.transaction(tx => this.createInTx(tx, userId, name, key)); }
  async createInTx(tx: AccountTx, userId: string, name: string, key: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-create:${userId}`},0))`);
    const hash = createHash('sha256').update(name).digest('hex');
    const [existing] = await tx.select().from(accounts).where(and(eq(accounts.ownerUserId, userId), eq(accounts.requestKey, key)));
    if (existing) { if (existing.requestHash !== hash) throw new ConflictException('Chave usada em outra contratação'); return existing; }
    const local = localAccountActivationAllowed();
    const [account] = await tx.insert(accounts).values({ ownerUserId: userId, name, requestKey: key, requestHash: hash, status: local ? 'ACTIVE' : 'PENDING' }).returning();
    await tx.insert(accountSubscriptions).values({ accountId: account.id, status: local ? 'ACTIVE' : 'PENDING', source: local ? 'LEGACY_DEV' : 'PENDING' });
    await tx.insert(userManagementEvents).values({ accountId: account.id, actorUserId: userId, eventType: local ? 'LOCAL_ACCOUNT_ACTIVATED' : 'ACCOUNT_CREATED' });
    return account;
  }
  async companyAccount(tx: AccountTx, userId: string, name: string, requestedId?: string) {
    if (requestedId) return (await this.owner(requestedId, userId, tx, true, true)).account.id;
    const [available] = await tx.select({ id: accounts.id }).from(accounts).innerJoin(accountSubscriptions, eq(accountSubscriptions.accountId, accounts.id)).where(and(eq(accounts.ownerUserId, userId), eq(accounts.status, 'ACTIVE'), eq(accountSubscriptions.status, 'ACTIVE'), sql`(${accountSubscriptions.source}='LEGACY_DEV' OR ${accountSubscriptions.currentPeriodEndsAt}>now())`)).orderBy(accounts.createdAt).limit(1);
    if (available) return (await this.owner(available.id, userId, tx, true, true)).account.id;
    if (!localAccountActivationAllowed()) throw new ForbiddenException('Abra uma contratação e ative seu plano antes de cadastrar a empresa');
    return (await this.createInTx(tx, userId, name, 'local-default-account')).id;
  }
  // Server-internal boundary for a future verified billing integration. No public activation endpoint.
  async applySubscription(accountId: string, expectedVersion: number, eventKey: string, input: { status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED'; source: 'BILLING' | 'MANUAL'; additionalUsersPerCompany: number; currentPeriodEndsAt: string | null }) {
    const validated = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELED']), source: z.enum(['BILLING', 'MANUAL']), additionalUsersPerCompany: z.number().int().min(0).max(10000), currentPeriodEndsAt: z.iso.datetime({ offset: true }).nullable() }).refine(v => v.status !== 'ACTIVE' || !!v.currentPeriodEndsAt, 'Plano ativo exige validade').parse(input);
    const requestHash = createHash('sha256').update(JSON.stringify({ expectedVersion, ...validated })).digest('hex');
    return this.database.db.transaction(async tx => {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for('update');
      if (!account) throw new NotFoundException('Contratação não encontrada');
      const key = z.string().min(1).max(170).parse(eventKey), requestKey = `subscription/${key}`;
      const [previous] = await tx.select().from(userManagementCommands).where(and(eq(userManagementCommands.accountId, accountId), eq(userManagementCommands.actorUserId, account.ownerUserId), eq(userManagementCommands.requestKey, requestKey)));
      if (previous) { if (previous.requestHash !== requestHash) throw new ConflictException('Evento de assinatura conflitante'); return previous.result; }
      const [subscription] = await tx.select().from(accountSubscriptions).where(eq(accountSubscriptions.accountId, accountId)).for('update');
      if (subscription.version !== expectedVersion) throw new ConflictException('Versão da assinatura mudou');
      const [updated] = await tx.update(accountSubscriptions).set({ ...validated, currentPeriodEndsAt: validated.currentPeriodEndsAt ? new Date(validated.currentPeriodEndsAt) : null, version: expectedVersion + 1, updatedAt: new Date() }).where(eq(accountSubscriptions.accountId, accountId)).returning();
      await tx.update(accounts).set({ status: validated.status, updatedAt: new Date() }).where(eq(accounts.id, accountId));
      await tx.insert(userManagementEvents).values({ accountId, eventType: 'SUBSCRIPTION_UPDATED', changes: { status: validated.status, additionalUsersPerCompany: validated.additionalUsersPerCompany, version: updated.version } });
      const result = { accountId, status: updated.status, version: updated.version };
      await tx.insert(userManagementCommands).values({ accountId, actorUserId: account.ownerUserId, requestKey, requestHash, operation: 'SUBSCRIPTION', result });
      return result;
    });
  }
}
