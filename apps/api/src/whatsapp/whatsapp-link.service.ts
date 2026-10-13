import { companyAvailable } from '../accounts/account-policy.js';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { companies, companyUsers, users, whatsappConnections, whatsappConsentEvents, whatsappLinkChallenges, whatsappLinkCompanies, whatsappLinks, whatsappOutboundMessages, whatsappRequests, whatsappSessions } from '@gestaonf/database/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export type LinkChallengeInput = { mode?: 'NEW_NUMBER' | 'EXISTING_NUMBER'; linkId?: string };
export function connectionToken(text: string) {
  return text.trim().match(/^Quero\s+vincular\s+minha\s+empresa\s+.+?\s+ao\s+meu\s+secret[aá]rio\s+virtual,\s*meu\s+c[oó]digo\s+[eé]\s+([A-Za-z0-9_-]{16,})\.?$/i)?.[1]
    ?? text.trim().match(/^VINCULAR\s+(?:NERO|NILO)\s+([A-Za-z0-9_-]{16,})$/i)?.[1];
}

@Injectable()
export class WhatsAppLinkService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async ensurePlatformConnection() {
    const appId = process.env.META_APP_ID?.trim(), accountId = process.env.META_WABA_ID?.trim(), phoneNumberId = process.env.META_PHONE_NUMBER_ID?.trim();
    const displayPhoneNumber = (process.env.META_DISPLAY_PHONE_NUMBER ?? '').replace(/\D/g, '');
    if (process.env.META_WHATSAPP_ENABLED !== 'true' || !appId || !accountId || !phoneNumberId || !displayPhoneNumber) return null;
    const environment = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'DEVELOPMENT';
    const condition = and(eq(whatsappConnections.environment, environment), eq(whatsappConnections.phoneNumberId, phoneNumberId));
    const [existing] = await this.database.db.select().from(whatsappConnections).where(condition).limit(1);
    if (existing) return existing.status === 'ACTIVE' ? existing : null;
    const [created] = await this.database.db.insert(whatsappConnections).values({
      ownership: 'PLATFORM', environment, metaAppId: appId,
      businessPortfolioId: process.env.META_BUSINESS_PORTFOLIO_ID?.trim() || null,
      messagingAccountId: accountId, phoneNumberId,
      whatsappAccountId: process.env.META_WHATSAPP_ACCOUNT_ID?.trim() || null,
      displayPhoneNumber, graphApiVersion: process.env.META_GRAPH_API_VERSION ?? 'v26.0', status: 'ACTIVE',
    }).onConflictDoNothing().returning();
    if (created) return created;
    const [connection] = await this.database.db.select().from(whatsappConnections).where(condition).limit(1);
    return connection?.status === 'ACTIVE' ? connection : null;
  }

  async eligibleCompanies(linkId: string, userId: string) {
    return this.database.db.select({ companyLinkId: whatsappLinkCompanies.id, companyId: companies.id, name: companies.name })
      .from(whatsappLinkCompanies).innerJoin(whatsappLinks, eq(whatsappLinks.id, whatsappLinkCompanies.linkId))
      .innerJoin(companies, eq(companies.id, whatsappLinkCompanies.companyId))
      .innerJoin(companyUsers, and(eq(companyUsers.companyId, companies.id), eq(companyUsers.userId, whatsappLinkCompanies.userId)))
      .innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(whatsappLinkCompanies.linkId, linkId), eq(whatsappLinkCompanies.userId, userId), eq(whatsappLinkCompanies.status, 'ACTIVE'), eq(whatsappLinks.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE')))
      .orderBy(asc(companies.name), asc(companies.id));
  }

  async status(userId: string, companyId: string) {
    const connection = await this.ensurePlatformConnection();
    if (!connection) return { configured: false, linked: false, connection: null, link: null, verifiedNumbers: [] };
    const verifiedNumbers = await this.database.db.select({ id: whatsappLinks.id, phoneE164: whatsappLinks.phoneE164, verifiedAt: whatsappLinks.verifiedAt })
      .from(whatsappLinks).where(and(eq(whatsappLinks.connectionId, connection.id), eq(whatsappLinks.userId, userId), eq(whatsappLinks.status, 'ACTIVE'))).orderBy(desc(whatsappLinks.verifiedAt));
    const [association] = await this.database.db.select({ id: whatsappLinkCompanies.id, linkId: whatsappLinks.id, companyId: whatsappLinkCompanies.companyId, phoneE164: whatsappLinks.phoneE164, verifiedAt: whatsappLinkCompanies.verifiedAt })
      .from(whatsappLinkCompanies).innerJoin(whatsappLinks, eq(whatsappLinks.id, whatsappLinkCompanies.linkId))
      .where(and(eq(whatsappLinkCompanies.connectionId, connection.id), eq(whatsappLinkCompanies.userId, userId), eq(whatsappLinkCompanies.companyId, companyId), eq(whatsappLinkCompanies.status, 'ACTIVE'), eq(whatsappLinks.status, 'ACTIVE'))).limit(1);
    return { configured: true, linked: Boolean(association), connection: { displayPhoneNumber: connection.displayPhoneNumber, environment: connection.environment }, link: association ?? null, verifiedNumbers };
  }

  async createChallenge(userId: string, companyId: string, input: LinkChallengeInput = {}) {
    const connection = await this.ensurePlatformConnection();
    if (!connection) throw new ServiceUnavailableException('Configure a integração oficial do WhatsApp para gerar o QR Code');
    const mode = input.mode ?? 'NEW_NUMBER';
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${connection.id + ':' + userId}, 0))`);
      const [company] = await tx.select({ name: companies.name }).from(companies)
        .innerJoin(companyUsers, and(eq(companyUsers.companyId, companies.id), eq(companyUsers.userId, userId))).innerJoin(users, eq(users.id, companyUsers.userId))
        .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).limit(1);
      if (!company) throw new NotFoundException('Empresa não encontrada ou acesso indisponível');
      const [association] = await tx.select({ id: whatsappLinkCompanies.id }).from(whatsappLinkCompanies)
        .where(and(eq(whatsappLinkCompanies.connectionId, connection.id), eq(whatsappLinkCompanies.userId, userId), eq(whatsappLinkCompanies.companyId, companyId), eq(whatsappLinkCompanies.status, 'ACTIVE'))).limit(1);
      if (association) throw new ConflictException('Esta empresa já possui um WhatsApp vinculado. Desconecte nesta empresa antes de trocar o número.');
      if (mode === 'EXISTING_NUMBER') {
        if (!input.linkId) throw new BadRequestException('Selecione um número verificado');
        const [identity] = await tx.select({ id: whatsappLinks.id }).from(whatsappLinks)
          .where(and(eq(whatsappLinks.id, input.linkId), eq(whatsappLinks.connectionId, connection.id), eq(whatsappLinks.userId, userId), eq(whatsappLinks.status, 'ACTIVE'))).limit(1);
        if (!identity) throw new BadRequestException('Este número não está disponível para seu usuário');
      } else if (input.linkId) throw new BadRequestException('Não selecione um vínculo no modo de outro número');
      await tx.update(whatsappLinkChallenges).set({ status: 'CANCELED', updatedAt: new Date() })
        .where(and(eq(whatsappLinkChallenges.connectionId, connection.id), eq(whatsappLinkChallenges.userId, userId), eq(whatsappLinkChallenges.companyId, companyId), inArray(whatsappLinkChallenges.status, ['PENDING', 'CANDIDATE'])));
      const token = randomBytes(18).toString('base64url'), expiresAt = new Date(Date.now() + 10 * 60_000);
      const [challenge] = await tx.insert(whatsappLinkChallenges).values({ connectionId: connection.id, userId, companyId, tokenHash: hashToken(token), expiresAt, mode, expectedLinkId: mode === 'EXISTING_NUMBER' ? input.linkId : null }).returning({ id: whatsappLinkChallenges.id });
      const text = `Quero vincular minha empresa ${company.name} ao meu secretário virtual, meu código é ${token}.`;
      return { challengeId: challenge.id, expiresAt: expiresAt.toISOString(), waLink: `https://wa.me/${connection.displayPhoneNumber}?text=${encodeURIComponent(text)}`, displayPhoneNumber: connection.displayPhoneNumber, instruction: 'Escaneie o QR Code e envie a mensagem pronta no WhatsApp.' };
    });
  }

  async challengeStatus(userId: string, companyId: string, challengeId: string) {
    const [challenge] = await this.database.db.select({ id: whatsappLinkChallenges.id, status: whatsappLinkChallenges.status, expiresAt: whatsappLinkChallenges.expiresAt, candidatePhoneE164: whatsappLinkChallenges.candidatePhoneE164 })
      .from(whatsappLinkChallenges).where(and(eq(whatsappLinkChallenges.id, challengeId), eq(whatsappLinkChallenges.userId, userId), eq(whatsappLinkChallenges.companyId, companyId))).limit(1);
    if (!challenge) throw new NotFoundException('Vínculo temporário não encontrado');
    if (challenge.expiresAt <= new Date() && ['PENDING', 'CANDIDATE'].includes(challenge.status)) {
      await this.database.db.update(whatsappLinkChallenges).set({ status: 'EXPIRED', updatedAt: new Date() }).where(and(eq(whatsappLinkChallenges.id, challenge.id), inArray(whatsappLinkChallenges.status, ['PENDING', 'CANDIDATE'])));
      return { ...challenge, status: 'EXPIRED' };
    }
    return challenge;
  }

  async captureCandidate(connectionId: string, senderId: string, phoneE164: string | null, text: string) {
    const token = connectionToken(text);
    if (!token) return null;
    return this.database.db.transaction(async (tx) => {
      const rejected = { accepted: false, message: 'Não foi possível usar esse código de vínculo. Gere outro QR Code no GestãoNF.' };
      const [challenge] = await tx.select().from(whatsappLinkChallenges).where(and(eq(whatsappLinkChallenges.connectionId, connectionId), eq(whatsappLinkChallenges.tokenHash, hashToken(token)))).limit(1).for('update');
      if (!challenge || !['PENDING', 'CANDIDATE'].includes(challenge.status)) return rejected;
      if (challenge.expiresAt <= new Date()) {
        await tx.update(whatsappLinkChallenges).set({ status: 'EXPIRED', updatedAt: new Date() }).where(eq(whatsappLinkChallenges.id, challenge.id));
        return rejected;
      }
      const [owner] = await tx.select({ id: whatsappLinks.id, userId: whatsappLinks.userId }).from(whatsappLinks).where(and(eq(whatsappLinks.connectionId, connectionId), eq(whatsappLinks.senderId, senderId), eq(whatsappLinks.status, 'ACTIVE'))).limit(1);
      if ((challenge.expectedLinkId && owner?.id !== challenge.expectedLinkId) || (owner && owner.userId !== challenge.userId) || (challenge.candidateSenderId && challenge.candidateSenderId !== senderId)) {
        const attempts = challenge.attempts + 1;
        await tx.update(whatsappLinkChallenges).set({ attempts, status: attempts >= 5 ? 'CANCELED' : challenge.status, updatedAt: new Date() }).where(eq(whatsappLinkChallenges.id, challenge.id));
        return { accepted: false, message: 'Use o número escolhido no GestãoNF. Para vincular outro número, gere o QR Code pela opção Vincular outro número.' };
      }
      await tx.update(whatsappLinkChallenges).set({ candidateSenderId: senderId, candidatePhoneE164: phoneE164, status: 'CANDIDATE', updatedAt: new Date() }).where(eq(whatsappLinkChallenges.id, challenge.id));
      return { accepted: true, message: 'Recebi sua solicitação de vínculo. Volte ao GestãoNF e confirme o número para concluir com segurança.' };
    });
  }

  async confirm(userId: string, companyId: string, challengeId: string) {
    try {
      return await this.database.db.transaction(async (tx) => {
        const [initial] = await tx.select({ connectionId: whatsappLinkChallenges.connectionId }).from(whatsappLinkChallenges).where(and(eq(whatsappLinkChallenges.id, challengeId), eq(whatsappLinkChallenges.userId, userId), eq(whatsappLinkChallenges.companyId, companyId))).limit(1);
        if (!initial) throw new NotFoundException('Vínculo temporário não encontrado');
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${initial.connectionId + ':' + userId}, 0))`);
        const [challenge] = await tx.select().from(whatsappLinkChallenges).where(eq(whatsappLinkChallenges.id, challengeId)).limit(1).for('update');
        const [membership] = await tx.select({ id: users.id }).from(companyUsers).innerJoin(users, eq(users.id, companyUsers.userId)).innerJoin(companies, eq(companies.id, companyUsers.companyId))
          .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id))).limit(1);
        if (!membership) throw new BadRequestException('Seu usuário não possui acesso ativo a esta empresa');
        if (challenge.status === 'CONFIRMED') {
          const [existing] = await tx.select({ phoneE164: whatsappLinks.phoneE164, verifiedAt: whatsappLinkCompanies.verifiedAt }).from(whatsappLinkCompanies).innerJoin(whatsappLinks, eq(whatsappLinks.id, whatsappLinkCompanies.linkId))
            .where(and(eq(whatsappLinkCompanies.challengeId, challenge.id), eq(whatsappLinkCompanies.status, 'ACTIVE'), eq(whatsappLinks.status, 'ACTIVE'))).limit(1);
          if (!existing) throw new BadRequestException('Este vínculo foi removido. Gere outro QR Code.');
          return { linked: true, ...existing };
        }
        if (challenge.status !== 'CANDIDATE' || !challenge.candidateSenderId) throw new BadRequestException('Envie primeiro a mensagem pronta pelo WhatsApp');
        if (challenge.expiresAt <= new Date()) throw new BadRequestException('Este QR Code expirou. Gere outro para continuar');
        const [owner] = await tx.select().from(whatsappLinks).where(and(eq(whatsappLinks.connectionId, challenge.connectionId), eq(whatsappLinks.senderId, challenge.candidateSenderId), eq(whatsappLinks.status, 'ACTIVE'))).limit(1);
        if (owner && owner.userId !== userId) throw new ConflictException('Este WhatsApp já está vinculado a outro usuário');
        if (challenge.expectedLinkId && owner?.id !== challenge.expectedLinkId) throw new BadRequestException('O número escolhido não está mais disponível');
        const [association] = await tx.select({ id: whatsappLinkCompanies.id }).from(whatsappLinkCompanies).where(and(eq(whatsappLinkCompanies.connectionId, challenge.connectionId), eq(whatsappLinkCompanies.userId, userId), eq(whatsappLinkCompanies.companyId, companyId), eq(whatsappLinkCompanies.status, 'ACTIVE'))).limit(1);
        if (association) throw new ConflictException('Esta empresa já possui um número vinculado');
        const link = owner ?? (await tx.insert(whatsappLinks).values({ connectionId: challenge.connectionId, userId, senderId: challenge.candidateSenderId, phoneE164: challenge.candidatePhoneE164 }).returning())[0];
        const [companyLink] = await tx.insert(whatsappLinkCompanies).values({ linkId: link.id, connectionId: link.connectionId, userId, companyId, challengeId: challenge.id }).returning();
        await tx.insert(whatsappSessions).values({ linkId: link.id, userId }).onConflictDoNothing();
        await tx.insert(whatsappConsentEvents).values({ linkId: link.id, companyLinkId: companyLink.id, event: 'GRANTED', source: 'WEB', actorUserId: userId });
        await tx.update(whatsappLinkChallenges).set({ status: 'CONFIRMED', confirmedAt: new Date(), updatedAt: new Date() }).where(eq(whatsappLinkChallenges.id, challenge.id));
        return { linked: true, phoneE164: link.phoneE164, verifiedAt: companyLink.verifiedAt };
      });
    } catch (error) {
      const detail = error as { code?: string; cause?: { code?: string } };
      if (detail.code === '23505' || detail.cause?.code === '23505') throw new ConflictException('Este número ou esta empresa já foi vinculado. Atualize a tela.');
      throw error;
    }
  }

  async disconnect(userId: string, companyId: string) {
    const connection = await this.ensurePlatformConnection();
    if (!connection) return;
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${connection.id + ':' + userId}, 0))`);
      await tx.update(whatsappLinkChallenges).set({ status: 'CANCELED', updatedAt: new Date() }).where(and(eq(whatsappLinkChallenges.connectionId, connection.id), eq(whatsappLinkChallenges.userId, userId), eq(whatsappLinkChallenges.companyId, companyId), inArray(whatsappLinkChallenges.status, ['PENDING', 'CANDIDATE'])));
      const [association] = await tx.update(whatsappLinkCompanies).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(whatsappLinkCompanies.connectionId, connection.id), eq(whatsappLinkCompanies.userId, userId), eq(whatsappLinkCompanies.companyId, companyId), eq(whatsappLinkCompanies.status, 'ACTIVE'))).returning();
      if (!association) return;
      await tx.update(whatsappRequests).set({ status: 'CANCELED', updatedAt: new Date() }).where(and(eq(whatsappRequests.companyLinkId, association.id), inArray(whatsappRequests.status, ['AWAITING_COMPANY', 'AWAITING_REPLY', 'READY', 'PROCESSING'])));
      await tx.update(whatsappOutboundMessages).set({ status: 'CANCELED', failureReason: 'Vínculo empresarial removido', updatedAt: new Date() }).where(and(eq(whatsappOutboundMessages.companyLinkId, association.id), inArray(whatsappOutboundMessages.status, ['QUEUED', 'SENDING'])));
      await tx.insert(whatsappConsentEvents).values({ linkId: association.linkId, companyLinkId: association.id, event: 'REVOKED', source: 'WEB', actorUserId: userId });
      const [remaining] = await tx.select({ id: whatsappLinkCompanies.id }).from(whatsappLinkCompanies).where(and(eq(whatsappLinkCompanies.linkId, association.linkId), eq(whatsappLinkCompanies.status, 'ACTIVE'))).limit(1);
      if (!remaining) {
        await tx.update(whatsappLinks).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() }).where(eq(whatsappLinks.id, association.linkId));
        await tx.update(whatsappSessions).set({ mode: 'PAUSED', activeCompanyId: null, updatedAt: new Date() }).where(eq(whatsappSessions.linkId, association.linkId));
        await tx.update(whatsappRequests).set({ status: 'CANCELED', updatedAt: new Date() }).where(and(eq(whatsappRequests.linkId, association.linkId), inArray(whatsappRequests.status, ['AWAITING_COMPANY', 'AWAITING_REPLY', 'READY', 'PROCESSING'])));
      }
    });
  }

  async disconnectNumber(linkId: string, userId: string) {
    await this.database.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(whatsappLinks).where(and(eq(whatsappLinks.id, linkId), eq(whatsappLinks.userId, userId))).limit(1);
      if (!identity) return;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity.connectionId + ':' + userId}, 0))`);
      const associations = await tx.update(whatsappLinkCompanies).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(whatsappLinkCompanies.linkId, linkId), eq(whatsappLinkCompanies.status, 'ACTIVE'))).returning();
      await tx.update(whatsappLinkChallenges).set({ status: 'CANCELED', updatedAt: new Date() })
        .where(and(eq(whatsappLinkChallenges.expectedLinkId, linkId), inArray(whatsappLinkChallenges.status, ['PENDING', 'CANDIDATE'])));
      await tx.update(whatsappRequests).set({ status: 'CANCELED', updatedAt: new Date() })
        .where(and(eq(whatsappRequests.linkId, linkId), inArray(whatsappRequests.status, ['AWAITING_COMPANY', 'AWAITING_REPLY', 'READY', 'PROCESSING'])));
      await tx.update(whatsappOutboundMessages).set({ status: 'CANCELED', failureReason: 'Número desconectado', updatedAt: new Date() })
        .where(and(eq(whatsappOutboundMessages.linkId, linkId), inArray(whatsappOutboundMessages.status, ['QUEUED', 'SENDING'])));
      await tx.update(whatsappLinks).set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() }).where(eq(whatsappLinks.id, linkId));
      await tx.update(whatsappSessions).set({ mode: 'PAUSED', activeCompanyId: null, updatedAt: new Date() }).where(eq(whatsappSessions.linkId, linkId));
      await tx.insert(whatsappConsentEvents).values([
        ...associations.map((association) => ({ linkId, companyLinkId: association.id, event: 'REVOKED', source: 'WHATSAPP', actorUserId: userId })),
        { linkId, companyLinkId: null, event: 'REVOKED', source: 'WHATSAPP', actorUserId: userId },
      ]);
    });
  }

  async canSend(message: { linkId: string | null; connectionId: string; recipientId: string; companyId: string | null; companyLinkId: string | null; requestId: string | null }) {
    if (!message.linkId) return !message.companyId && !message.companyLinkId && !message.requestId;
    const [identity] = await this.database.db.select({ userId: whatsappLinks.userId }).from(whatsappLinks).innerJoin(users, eq(users.id, whatsappLinks.userId))
      .where(and(eq(whatsappLinks.id, message.linkId), eq(whatsappLinks.connectionId, message.connectionId), eq(whatsappLinks.senderId, message.recipientId), eq(whatsappLinks.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).limit(1);
    if (!identity) return false;
    const eligible = await this.eligibleCompanies(message.linkId, identity.userId);
    if (message.companyId && !eligible.some((item) => item.companyId === message.companyId && item.companyLinkId === message.companyLinkId)) return false;
    if (message.companyLinkId && !message.companyId) return false;
    if (message.requestId) {
      const [request] = await this.database.db.select().from(whatsappRequests).where(and(eq(whatsappRequests.id, message.requestId), eq(whatsappRequests.linkId, message.linkId), eq(whatsappRequests.userId, identity.userId))).limit(1);
      if (!request || ['CANCELED', 'EXPIRED'].includes(request.status)) return false;
      if (message.companyId) return request.companyId === message.companyId && request.companyLinkId === message.companyLinkId;
      return request.status === 'AWAITING_COMPANY' && request.expiresAt > new Date() && request.options.every((option) => eligible.some((item) => item.companyLinkId === option.companyLinkId));
    }
    return !message.companyId;
  }
}
