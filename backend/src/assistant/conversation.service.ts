// backend/src/assistant/conversation.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { neroConversations, neroMessages } from '@gestaonf/database/schema';
import { and, asc, desc, eq, lt, ne } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import type { DbExecutor } from './db-types.js';

export type Conversation = typeof neroConversations.$inferSelect;
export type ConversationRole = 'USER' | 'ASSISTANT' | 'TOOL';
export type ConversationSource = 'TEXT' | 'AUDIO' | 'BUTTON' | 'SYSTEM';
export type CloseReason = 'IDLE' | 'NEW_TOPIC' | 'COMPANY_SWITCH' | 'LINK_REVOKED';
export type HistoryItem = { role: ConversationRole; content: string; source: string; createdAt: Date };
export type NewMessage = { role: ConversationRole; content: string; source?: ConversationSource; inboxEventId?: string | null; outboundMessageId?: string | null };
type LinkRef = { id: string; userId: string };
type CompanyRef = { companyId: string; companyLinkId: string };

function positiveNumber(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const idleMs = () => positiveNumber('NERO_CONVERSATION_IDLE_MIN', 60) * 60_000;
const historyLimit = () => positiveNumber('NERO_HISTORY_LIMIT', 30);

@Injectable()
export class ConversationService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async openOf(linkId: string) {
    const [open] = await this.database.db.select().from(neroConversations)
      .where(and(eq(neroConversations.linkId, linkId), ne(neroConversations.status, 'CLOSED'))).limit(1);
    return open ?? null;
  }

  async close(conversationId: string, reason: CloseReason, now = new Date()) {
    await this.database.db.update(neroConversations).set({ status: 'CLOSED', closedAt: now, closedReason: reason, updatedAt: now })
      .where(and(eq(neroConversations.id, conversationId), ne(neroConversations.status, 'CLOSED')));
  }

  async open(link: LinkRef, company: CompanyRef | null, now = new Date()) {
    const [created] = await this.database.db.insert(neroConversations).values({
      linkId: link.id, userId: link.userId, status: company ? 'ACTIVE' : 'AWAITING_COMPANY',
      companyId: company?.companyId ?? null, companyLinkId: company?.companyLinkId ?? null, lastActivityAt: now,
    }).onConflictDoNothing().returning();
    if (created) return created;
    const existing = await this.openOf(link.id);
    if (!existing) throw new Error('Conversa não encontrada após conflito');
    return existing;
  }

  /** Retoma a conversa aberta ou abre outra (expiração, empresa sem acesso). Uma empresa elegível dispensa a pergunta. */
  async resumeOrOpen(link: LinkRef, eligible: CompanyRef[], now = new Date()) {
    const existing = await this.openOf(link.id);
    if (existing) {
      if (existing.lastActivityAt.getTime() < now.getTime() - idleMs()) await this.close(existing.id, 'IDLE', now);
      else if (existing.status === 'ACTIVE' && !eligible.some((item) => item.companyLinkId === existing.companyLinkId)) await this.close(existing.id, 'LINK_REVOKED', now);
      else if (existing.status === 'AWAITING_COMPANY' && eligible.length === 1) {
        const selected = await this.selectCompany(existing.id, eligible[0]);
        return selected ?? existing;
      } else return existing;
    }
    return this.open(link, eligible.length === 1 ? eligible[0] : null, now);
  }

  /** A conversa foi aberta porque a anterior (a mais recente encerrada do vínculo) trocou de empresa. */
  async openedByCompanySwitch(conversation: Pick<Conversation, 'id' | 'linkId'>) {
    const [previous] = await this.database.db.select({ reason: neroConversations.closedReason }).from(neroConversations)
      .where(and(eq(neroConversations.linkId, conversation.linkId), eq(neroConversations.status, 'CLOSED'), ne(neroConversations.id, conversation.id)))
      .orderBy(desc(neroConversations.closedAt)).limit(1);
    return previous?.reason === 'COMPANY_SWITCH';
  }

  async selectCompany(conversationId: string, company: CompanyRef) {
    const [selected] = await this.database.db.update(neroConversations)
      .set({ status: 'ACTIVE', companyId: company.companyId, companyLinkId: company.companyLinkId, lastActivityAt: new Date(), updatedAt: new Date() })
      .where(and(eq(neroConversations.id, conversationId), eq(neroConversations.status, 'AWAITING_COMPANY'))).returning();
    return selected ?? null;
  }

  async touch(conversationId: string, now = new Date()) {
    await this.database.db.update(neroConversations).set({ lastActivityAt: now, updatedAt: now }).where(eq(neroConversations.id, conversationId));
  }

  /** Grava falas em ordem: a ordem real vem de `seq` (identidade do banco), não do relógio. */
  async append(conversationId: string, entries: NewMessage[], executor: DbExecutor = this.database.db) {
    const rows = entries.filter((entry) => entry.content.trim()).map((entry) => ({
      conversationId, role: entry.role, content: entry.content.trim(), source: entry.source ?? 'TEXT',
      inboxEventId: entry.inboxEventId ?? null, outboundMessageId: entry.outboundMessageId ?? null,
    }));
    if (rows.length) await executor.insert(neroMessages).values(rows);
  }

  async history(conversationId: string): Promise<HistoryItem[]> {
    const rows = await this.database.db.select({ role: neroMessages.role, content: neroMessages.content, source: neroMessages.source, createdAt: neroMessages.createdAt })
      .from(neroMessages).where(eq(neroMessages.conversationId, conversationId))
      .orderBy(desc(neroMessages.seq)).limit(historyLimit());
    return rows.reverse().map((row) => ({ ...row, role: row.role as ConversationRole }));
  }

  /** Mensagens do usuário após a última resposta do Nero (o pedido em aberto). */
  async trailingUserMessages(conversationId: string) {
    const rows = await this.database.db.select().from(neroMessages).where(eq(neroMessages.conversationId, conversationId)).orderBy(asc(neroMessages.seq));
    const lastAssistant = rows.map((row) => row.role).lastIndexOf('ASSISTANT');
    return rows.slice(lastAssistant + 1).filter((row) => row.role === 'USER');
  }

  /** Retenção: apaga o conteúdo das conversas mais antigo que o prazo. */
  async purgeOlderThan(days = 30) {
    const limit = new Date(Date.now() - days * 86_400_000);
    const removed = await this.database.db.delete(neroMessages).where(lt(neroMessages.createdAt, limit)).returning({ id: neroMessages.id });
    return removed.length;
  }
}
