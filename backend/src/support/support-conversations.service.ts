import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { supportConversations, supportMessages } from '@gestaonf/database/schema';
import { and, count, desc, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { withExpiredActions, type ActionBlock, type SupportBlock } from './support-blocks.js';

export type SupportContext = { companyId: string; userId: string };
export type SupportMessageView = { id: string; role: 'user' | 'assistant'; createdAt: string; blocks: SupportBlock[] };
export type FinishAssistantMessage = {
  blocks: SupportBlock[]; llmItems: unknown[]; inputTokens: number | null; outputTokens: number | null; toolCallCount: number; errorCode: string | null;
};
type MessageRow = typeof supportMessages.$inferSelect;

const IDLE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SupportConversationsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async active(ctx: SupportContext, now = new Date()) {
    const [row] = await this.database.db.select().from(supportConversations).where(and(
      eq(supportConversations.companyId, ctx.companyId), eq(supportConversations.userId, ctx.userId), eq(supportConversations.status, 'ACTIVE'),
    )).limit(1);
    if (!row) return null;
    if (now.getTime() - row.lastMessageAt.getTime() > IDLE_MS) {
      await this.database.db.update(supportConversations).set({ status: 'CLOSED', closedAt: now })
        .where(and(eq(supportConversations.id, row.id), eq(supportConversations.status, 'ACTIVE')));
      return null;
    }
    return row;
  }

  async activeOrCreate(ctx: SupportContext, now = new Date()) {
    const current = await this.active(ctx, now);
    if (current) return current;
    const [created] = await this.database.db.insert(supportConversations).values({ companyId: ctx.companyId, userId: ctx.userId }).onConflictDoNothing().returning();
    if (created) return created;
    const concurrent = await this.active(ctx, now);
    if (!concurrent) throw new Error('Conversa de suporte não encontrada após criação concorrente');
    return concurrent;
  }

  async reset(ctx: SupportContext) {
    await this.database.db.update(supportConversations).set({ status: 'CLOSED', closedAt: new Date() }).where(and(
      eq(supportConversations.companyId, ctx.companyId), eq(supportConversations.userId, ctx.userId), eq(supportConversations.status, 'ACTIVE'),
    ));
  }

  toView(row: MessageRow, now = new Date()): SupportMessageView {
    return { id: row.id, role: row.role as 'user' | 'assistant', createdAt: row.createdAt.toISOString(), blocks: withExpiredActions(row.blocks as SupportBlock[], now) };
  }

  async messages(conversationId: string, now = new Date()) {
    const rows = await this.database.db.select().from(supportMessages).where(eq(supportMessages.conversationId, conversationId)).orderBy(asc(supportMessages.seq));
    return rows.map((row) => this.toView(row, now));
  }

  async history(conversationId: string, limit = 10): Promise<unknown[]> {
    const rows = await this.database.db.select({ llmItems: supportMessages.llmItems }).from(supportMessages)
      .where(eq(supportMessages.conversationId, conversationId)).orderBy(desc(supportMessages.seq)).limit(limit);
    return rows.reverse().flatMap((row) => row.llmItems);
  }

  async addUserMessage(ctx: SupportContext, conversationId: string, text: string) {
    const [row] = await this.database.db.insert(supportMessages).values({
      conversationId, companyId: ctx.companyId, role: 'user', blocks: [{ type: 'text', text }], llmItems: [{ role: 'user', content: text }],
    }).returning();
    await this.touch(conversationId);
    return this.toView(row);
  }

  /** A trava por empresa torna a verificação e a gravação do limite diário indivisíveis. */
  async addUserMessageWithinDailyLimit(ctx: SupportContext, conversationId: string, text: string, timezone: string, limit: number) {
    const row = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('support_daily'), hashtext(${ctx.companyId}))`);
      const [usage] = await tx.select({ total: count() }).from(supportMessages).where(and(
        eq(supportMessages.companyId, ctx.companyId), eq(supportMessages.role, 'user'),
        sql`${supportMessages.createdAt} >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})`,
      ));
      if (Number(usage?.total ?? 0) >= limit) {
        throw new HttpException({ message: 'Limite diário do assistente atingido. Os atalhos continuam disponíveis.', code: 'SUPPORT_DAILY_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const [inserted] = await tx.insert(supportMessages).values({
        conversationId, companyId: ctx.companyId, role: 'user', blocks: [{ type: 'text', text }], llmItems: [{ role: 'user', content: text }],
      }).returning();
      await tx.update(supportConversations).set({ lastMessageAt: new Date() }).where(eq(supportConversations.id, conversationId));
      return inserted;
    });
    return this.toView(row);
  }

  async startAssistantMessage(ctx: SupportContext, conversationId: string, model: string | null) {
    const [row] = await this.database.db.insert(supportMessages).values({ conversationId, companyId: ctx.companyId, role: 'assistant', blocks: [], model }).returning({ id: supportMessages.id });
    return row.id;
  }

  async finishAssistantMessage(id: string, data: FinishAssistantMessage) {
    const [row] = await this.database.db.update(supportMessages).set({
      blocks: data.blocks as Record<string, unknown>[], llmItems: data.llmItems, inputTokens: data.inputTokens,
      outputTokens: data.outputTokens, toolCallCount: data.toolCallCount, errorCode: data.errorCode,
    }).where(eq(supportMessages.id, id)).returning();
    await this.touch(row.conversationId);
    return this.toView(row);
  }

  async updateActionBlock(messageId: string, block: ActionBlock) {
    const [row] = await this.database.db.select({ blocks: supportMessages.blocks }).from(supportMessages).where(eq(supportMessages.id, messageId)).limit(1);
    if (!row) return;
    const blocks = (row.blocks as SupportBlock[]).map((item) => item.type === 'action' && item.actionId === block.actionId ? block : item);
    await this.database.db.update(supportMessages).set({ blocks: blocks as Record<string, unknown>[] }).where(eq(supportMessages.id, messageId));
  }

  async countUserMessagesToday(companyId: string, timezone: string) {
    const [row] = await this.database.db.select({ total: count() }).from(supportMessages).where(and(
      eq(supportMessages.companyId, companyId), eq(supportMessages.role, 'user'),
      sql`${supportMessages.createdAt} >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})`,
    ));
    return Number(row?.total ?? 0);
  }

  private async touch(conversationId: string) {
    await this.database.db.update(supportConversations).set({ lastMessageAt: new Date() }).where(eq(supportConversations.id, conversationId));
  }
}
