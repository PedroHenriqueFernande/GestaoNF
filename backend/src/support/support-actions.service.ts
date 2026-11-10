import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { supportActions, supportMessages } from '@gestaonf/database/schema';
import { and, eq, gt } from 'drizzle-orm';
import { isUniqueViolation } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import { CustomersService } from '../customers/customers.service.js';
import { createCustomerSchema } from '../customers/customers.schemas.js';
import { ServicesService } from '../services/services.service.js';
import { createServiceSchema } from '../services/services.schemas.js';
import type { ActionBlock, ActionKind, ActionStatus, SupportBlock } from './support-blocks.js';
import { SupportConversationsService, type SupportContext } from './support-conversations.service.js';
import { httpMessage } from './support-errors.js';

type ActionRow = typeof supportActions.$inferSelect;
type SupportTx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export type ActionDraftContext = SupportContext & { conversationId: string; messageId: string };

const ACTION_TTL_MS = 15 * 60 * 1000;
const labels: Record<ActionKind, Record<string, string>> = {
  CREATE_CUSTOMER: { kind: 'Tipo', name: 'Nome', tradeName: 'Nome fantasia', taxId: 'CPF/CNPJ', email: 'E-mail', phone: 'Telefone', cityName: 'Cidade', stateCode: 'UF', notes: 'Observações' },
  CREATE_SERVICE: { name: 'Nome', internalCode: 'Código interno', description: 'Descrição', unitLabel: 'Unidade', suggestedUnitPrice: 'Preço sugerido', nationalTaxCode: 'Código de tributação nacional' },
};

function formatValue(key: string, value: unknown) {
  if (key === 'kind') return value === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física';
  if (key === 'suggestedUnitPrice') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
  return String(value);
}

export function actionSummary(kind: ActionKind, payload: Record<string, unknown>) {
  return Object.entries(labels[kind])
    .filter(([key]) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .map(([key, label]) => ({ label, value: formatValue(key, payload[key]) }));
}

export function actionBlock(row: ActionRow): ActionBlock {
  const kind = row.kind as ActionKind;
  const status = row.status as ActionStatus;
  return {
    type: 'action', actionId: row.id, kind, status, summary: actionSummary(kind, row.payload), expiresAt: row.expiresAt.toISOString(),
    ...(status === 'CONFIRMED' ? { resultTo: kind === 'CREATE_CUSTOMER' ? '/Clientes' : '/servicos' } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
  };
}

@Injectable()
export class SupportActionsService {
  private readonly logger = new Logger(SupportActionsService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(ServicesService) private readonly services: ServicesService,
    @Inject(SupportConversationsService) private readonly conversations: SupportConversationsService,
  ) {}

  async prepare(ctx: ActionDraftContext, kind: ActionKind, payload: Record<string, unknown>): Promise<ActionBlock> {
    const row = await this.database.db.transaction(async (tx) => {
      const canceled = await tx.update(supportActions).set({ status: 'CANCELED', updatedAt: new Date() })
        .where(and(eq(supportActions.conversationId, ctx.conversationId), eq(supportActions.status, 'PENDING'))).returning();
      const [row] = await tx.insert(supportActions).values({
        conversationId: ctx.conversationId, messageId: ctx.messageId, companyId: ctx.companyId, userId: ctx.userId,
        kind, payload, expiresAt: new Date(Date.now() + ACTION_TTL_MS),
      }).returning();
      for (const previous of canceled) await this.updateActionBlockInTx(tx, previous.messageId, actionBlock(previous), false);
      return row;
    });
    return actionBlock(row);
  }

  async confirm(ctx: SupportContext, id: string): Promise<ActionBlock> {
    await this.claimable(ctx, id);
    const row = await this.database.db.transaction(async (tx) => {
      const [claimed] = await tx.update(supportActions).set({ status: 'CONFIRMED', confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(supportActions.id, id), eq(supportActions.status, 'PENDING'), gt(supportActions.expiresAt, new Date()))).returning();
      if (!claimed) throw new ConflictException('Esta ação já foi concluída.');
      let entityId: string;
      try {
        // Savepoint: se o cadastro falhar, só ele é desfeito e a transação externa registra o FAILED.
        entityId = await tx.transaction(async (sp) => {
          const entity = claimed.kind === 'CREATE_CUSTOMER'
            ? await this.customers.createInTx(sp, ctx.companyId, ctx.userId, createCustomerSchema.parse(claimed.payload))
            : await this.services.createInTx(sp, ctx.companyId, ctx.userId, createServiceSchema.parse(claimed.payload));
          return entity.id;
        });
      } catch (error) {
        const message = this.failureMessage(claimed.kind as ActionKind, error);
        if (!(error instanceof HttpException) && !isUniqueViolation(error)) this.logger.error(`support_action_failed id=${id} error=${error instanceof Error ? error.constructor.name : typeof error}`);
        const [failed] = await tx.update(supportActions).set({ status: 'FAILED', confirmedAt: null, errorMessage: message, updatedAt: new Date() })
          .where(eq(supportActions.id, id)).returning();
        await this.updateActionBlockInTx(tx, failed.messageId, actionBlock(failed));
        return failed;
      }
      // Fora do try: falha aqui desfaz a transação inteira (ação segue PENDING, nada é criado).
      const [done] = await tx.update(supportActions).set({ resultEntityId: entityId, updatedAt: new Date() }).where(eq(supportActions.id, id)).returning();
      await this.updateActionBlockInTx(tx, done.messageId, actionBlock(done));
      return done;
    });
    const block = actionBlock(row);
    return block;
  }

  private async updateActionBlockInTx(tx: SupportTx, messageId: string, block: ActionBlock, required = true) {
    const [message] = await tx.select({ blocks: supportMessages.blocks }).from(supportMessages)
      .where(eq(supportMessages.id, messageId)).limit(1);
    if (!message) {
      if (required) throw new Error('Mensagem da ação de suporte não encontrada');
      return;
    }
    let found = false;
    const blocks = (message.blocks as SupportBlock[]).map((item) => {
      if (item.type !== 'action' || item.actionId !== block.actionId) return item;
      found = true;
      return block;
    });
    if (!found) {
      if (required) throw new Error('Cartão da ação de suporte não encontrado');
      return;
    }
    await tx.update(supportMessages).set({ blocks: blocks as Record<string, unknown>[] })
      .where(eq(supportMessages.id, messageId));
  }

  private failureMessage(kind: ActionKind, error: unknown) {
    if (isUniqueViolation(error)) return kind === 'CREATE_CUSTOMER' ? 'CPF/CNPJ já cadastrado nesta empresa' : 'Código interno já cadastrado nesta empresa';
    if (error instanceof HttpException) return httpMessage(error);
    return 'Não foi possível concluir o cadastro.';
  }

  async cancel(ctx: SupportContext, id: string): Promise<ActionBlock> {
    await this.claimable(ctx, id);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx.update(supportActions).set({ status: 'CANCELED', updatedAt: new Date() })
        .where(and(eq(supportActions.id, id), eq(supportActions.status, 'PENDING'), gt(supportActions.expiresAt, new Date()))).returning();
      if (!row) throw new ConflictException('Esta ação já foi concluída.');
      const block = actionBlock(row);
      await this.updateActionBlockInTx(tx, row.messageId, block);
      return block;
    });
  }
  /** Garante dono, estado PENDING e validade; marca EXPIRED quando vencida. */
  private async claimable(ctx: SupportContext, id: string) {
    const [row] = await this.database.db.select().from(supportActions)
      .where(and(eq(supportActions.id, id), eq(supportActions.companyId, ctx.companyId), eq(supportActions.userId, ctx.userId))).limit(1);
    if (!row) throw new NotFoundException('Ação não encontrada.');
    if (row.status === 'PENDING' && row.expiresAt.getTime() <= Date.now()) {
      await this.database.db.transaction(async (tx) => {
        const [expired] = await tx.update(supportActions).set({ status: 'EXPIRED', updatedAt: new Date() })
          .where(and(eq(supportActions.id, id), eq(supportActions.status, 'PENDING'))).returning();
        if (expired) await this.updateActionBlockInTx(tx, expired.messageId, actionBlock(expired));
      });
      throw new ConflictException('Esta ação expirou. Peça novamente ao assistente.');
    }    if (row.status !== 'PENDING') throw new ConflictException('Esta ação já foi concluída.');
    return row;
  }
}
