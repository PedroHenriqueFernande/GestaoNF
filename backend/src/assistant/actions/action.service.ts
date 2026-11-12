// backend/src/assistant/actions/action.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { assistantActions, neroConversations, type NeroProposedOperation } from '@gestaonf/database/schema';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.module.js';
import type { DbExecutor } from '../db-types.js';
import type { ExecutionContext } from '../execution-context.js';
import { ToolRegistry } from '../tools/registry.js';
import type { OperationResult } from '../tools/types.js';
import { VERSION_CONFLICT_MESSAGE } from '../tools/write-support.js';
import { buildSummary } from './action-summary.js';
import { translateError, type FailureCause } from './error-translator.js';

export type ProposedOperation = NeroProposedOperation;
export type ProposeResult = { ok: true; actionId: string; summary: string } | { ok: false; cause: FailureCause };
export type ConfirmResult =
  | { status: 'EXECUTED' | 'ALREADY_EXECUTED'; labels: string[] }
  | { status: 'FAILED' | 'RETRYABLE'; cause: FailureCause }
  | { status: 'NOT_PENDING'; current: string };

const MAX_OPERATIONS = 10;
const ttlMinutes = () => { const value = Number(process.env.NERO_ACTION_TTL_MIN ?? '10'); return Number.isFinite(value) && value > 0 ? value : 10; };
const isUuid = (value: string) => z.uuid().safeParse(value).success;

class RollbackSignal extends Error {}
class OperationError extends Error {
  constructor(readonly index: number, readonly tool: string, readonly original: unknown) { super('Falha na operação', { cause: original }); }
}

/** UUID determinístico por ação e operação: chave de idempotência para os serviços de domínio. */
export function operationKey(actionId: string, index: number) {
  const hex = createHash('sha256').update(`${actionId}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function resolveRefs(value: unknown, results: { entityId: string | null }[]): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, results));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === '$ref') {
      const index = (value as { $ref: unknown }).$ref;
      const entityId = typeof index === 'number' ? results[index]?.entityId : null;
      if (!entityId) throw new BadRequestException('Referência a uma operação anterior inválida');
      return entityId;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, results)]));
  }
  return value;
}

const failureOf = (error: unknown) => error instanceof OperationError ? translateError(error.original, error.index, error.tool) : translateError(error, null, null);
type OperationVersion = { entityId: string; updatedAt: string } | null;

@Injectable()
export class ActionService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ToolRegistry) private readonly registry: ToolRegistry,
  ) {}

  private async runOperations(tx: DbExecutor, ctx: ExecutionContext, operations: ProposedOperation[], actionId: string, dryRun: boolean, versions?: OperationVersion[]) {
    const results: OperationResult[] = [];
    const touched = new Set<string>();
    for (const [index, operation] of operations.entries()) {
      const handler = this.registry.write(operation.tool);
      try {
        if (!handler || !handler.allowed(ctx)) throw new ForbiddenException('Operação não permitida para o seu usuário');
        const args = handler.schema.parse(resolveRefs(operation.args, results));
        let expectedVersion: string | undefined;
        // A chave é calculada uma única vez, dos argumentos, e é a mesma gravada na proposta e conferida na confirmação.
        const key = handler.versionKey?.(args) ?? (args as { id?: string }).id;
        if (!dryRun && handler.requiresVersion && !touched.has(`${handler.versionScope}:${key}`)) {
          const version = versions?.[index];
          if (!key || !version || version.entityId !== key || typeof version.updatedAt !== 'string') throw new ConflictException(VERSION_CONFLICT_MESSAGE);
          expectedVersion = version.updatedAt;
        }
        const result = await handler.execute(tx, ctx, args, { idempotencyKey: operationKey(actionId, index), dryRun, expectedVersion });
        results.push({ ...result, versionKey: key ?? result.versionKey });
        const touchedKey = key ?? result.versionKey ?? result.entityId;
        if (handler.versionScope && touchedKey) touched.add(`${handler.versionScope}:${touchedKey}`);
      } catch (error) {
        throw new OperationError(index, operation.tool, error);
      }
    }
    return results;
  }

  async propose(ctx: ExecutionContext, operations: ProposedOperation[]): Promise<ProposeResult> {
    if (!operations.length || operations.length > MAX_OPERATIONS) {
      return { ok: false, cause: { kind: 'VALIDATION', operationIndex: null, operation: null, message: `Envie de 1 a ${MAX_OPERATIONS} operações por confirmação`, fields: [] } };
    }
    let dryResults: OperationResult[] = [];
    try {
      await this.database.db.transaction(async (tx) => {
        dryResults = await this.runOperations(tx, ctx, operations, randomUUID(), true);
        throw new RollbackSignal();
      });
    } catch (error) {
      if (!(error instanceof RollbackSignal)) return { ok: false, cause: failureOf(error) };
    }
    const labels = dryResults.map((result) => result.label);
    const lines = operations.map((operation, index) => dryResults[index]?.summary ?? this.registry.write(operation.tool)!.summarize(operation.args, labels));
    const summary = buildSummary(ctx.companyName, lines, ttlMinutes());
    if (summary.length > 1024) {
      return { ok: false, cause: { kind: 'VALIDATION', operationIndex: null, operation: null, message: 'O resumo ficou grande demais para uma confirmação. Divida em partes menores.', fields: [] } };
    }
    const now = new Date();
    const actionId = await this.database.db.transaction(async (tx) => {
      // Serializa propostas concorrentes da mesma conversa (o índice único parcial é a garantia final).
      await tx.select({ id: neroConversations.id }).from(neroConversations).where(eq(neroConversations.id, ctx.conversationId)).for('update');
      await tx.update(assistantActions).set({ status: 'SUPERSEDED', updatedAt: now })
        .where(and(eq(assistantActions.conversationId, ctx.conversationId), eq(assistantActions.status, 'AWAITING_CONFIRMATION')));
      const [action] = await tx.insert(assistantActions).values({
        assistantRunId: ctx.runId, companyId: ctx.companyId, userId: ctx.userId, conversationId: ctx.conversationId,
        toolName: 'propor_operacoes', riskLevel: 'WRITE', status: 'AWAITING_CONFIRMATION',
        // Metadados calculados pelo servidor, separados dos argumentos controlados pelo modelo.
        arguments: { operations, operationVersions: dryResults.map((result): OperationVersion => (result.versionKey ?? result.entityId) && result.version ? { entityId: (result.versionKey ?? result.entityId)!, updatedAt: result.version } : null) }, operations, summaryText: summary,
        summaryHash: createHash('sha256').update(JSON.stringify(operations)).digest('hex'),
        confirmationExpiresAt: new Date(now.getTime() + ttlMinutes() * 60_000),
      }).returning({ id: assistantActions.id });
      return action.id;
    });
    return { ok: true, actionId, summary };
  }

  /** Proposta pendente da conversa; expira automaticamente. */
  async pending(conversationId: string) {
    const [action] = await this.database.db.select().from(assistantActions)
      .where(and(eq(assistantActions.conversationId, conversationId), eq(assistantActions.status, 'AWAITING_CONFIRMATION')))
      .orderBy(desc(assistantActions.createdAt)).limit(1);
    if (!action) return null;
    if (action.confirmationExpiresAt && action.confirmationExpiresAt <= new Date()) {
      await this.database.db.update(assistantActions).set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(assistantActions.id, action.id), eq(assistantActions.status, 'AWAITING_CONFIRMATION')));
      return null;
    }
    return action;
  }

  /** Última proposta da conversa em qualquer estado (para explicar que ela expirou ou foi substituída). */
  async latest(conversationId: string) {
    const [action] = await this.database.db.select().from(assistantActions)
      .where(eq(assistantActions.conversationId, conversationId)).orderBy(desc(assistantActions.createdAt)).limit(1);
    return action ?? null;
  }

  private async closePending(status: 'REJECTED' | 'SUPERSEDED', actionId: string, conversationId: string, userId: string) {
    if (!isUuid(actionId)) return false;
    const rows = await this.database.db.update(assistantActions).set({ status, updatedAt: new Date() })
      .where(and(eq(assistantActions.id, actionId), eq(assistantActions.conversationId, conversationId), eq(assistantActions.userId, userId), eq(assistantActions.status, 'AWAITING_CONFIRMATION')))
      .returning({ id: assistantActions.id });
    return rows.length > 0;
  }

  reject(actionId: string, conversationId: string, userId: string) {
    return this.closePending('REJECTED', actionId, conversationId, userId);
  }

  /** Substitui a proposta pendente (ex.: usuário tocou em Corrigir): ela deixa de poder ser confirmada. */
  supersede(actionId: string, conversationId: string, userId: string) {
    return this.closePending('SUPERSEDED', actionId, conversationId, userId);
  }

  /** Executa o lote em uma transação. Clique repetido encontra EXECUTED e não grava de novo. */
  async confirm(actionId: string, ctx: ExecutionContext): Promise<ConfirmResult> {
    if (!isUuid(actionId)) return { status: 'NOT_PENDING', current: 'NOT_FOUND' };
    try {
      return await this.database.db.transaction(async (tx): Promise<ConfirmResult> => {
        const [action] = await tx.select().from(assistantActions)
          .where(and(eq(assistantActions.id, actionId), eq(assistantActions.conversationId, ctx.conversationId), eq(assistantActions.userId, ctx.userId), eq(assistantActions.companyId, ctx.companyId)))
          .limit(1).for('update');
        if (!action) return { status: 'NOT_PENDING', current: 'NOT_FOUND' };
        if (action.status === 'EXECUTED') return { status: 'ALREADY_EXECUTED', labels: ((action.result as { labels?: string[] } | null)?.labels) ?? [] };
        if (action.status !== 'AWAITING_CONFIRMATION') return { status: 'NOT_PENDING', current: action.status };
        if (!action.confirmationExpiresAt || action.confirmationExpiresAt <= new Date()) {
          await tx.update(assistantActions).set({ status: 'EXPIRED', updatedAt: new Date() }).where(eq(assistantActions.id, action.id));
          return { status: 'NOT_PENDING', current: 'EXPIRED' };
        }
        const storedVersions = action.arguments.operationVersions;
        const results = await this.runOperations(tx, ctx, action.operations ?? [], action.id, false, Array.isArray(storedVersions) ? storedVersions as OperationVersion[] : undefined);
        const labels = results.map((result) => result.label);
        const now = new Date();
        await tx.update(assistantActions).set({ status: 'EXECUTED', confirmedAt: now, executedAt: now, result: { labels, entityIds: results.map((result) => result.entityId) }, updatedAt: now })
          .where(eq(assistantActions.id, action.id));
        return { status: 'EXECUTED', labels };
      });
    } catch (error) {
      const cause = failureOf(error);
      // As gravações abaixo são best-effort: com o banco fora, o resultado ainda precisa ser devolvido.
      try {
        if (cause.kind === 'UNEXPECTED') {
          const original = error instanceof OperationError ? error.original : error;
          await this.database.db.update(assistantActions).set({ lastError: original instanceof Error ? original.message : String(original), updatedAt: new Date() }).where(eq(assistantActions.id, actionId));
        } else {
          await this.database.db.update(assistantActions).set({ status: 'FAILED', failure: cause, updatedAt: new Date() })
            .where(and(eq(assistantActions.id, actionId), eq(assistantActions.status, 'AWAITING_CONFIRMATION')));
        }
      } catch { /* o erro original já está em cause */ }
      return { status: cause.kind === 'UNEXPECTED' ? 'RETRYABLE' : 'FAILED', cause };
    }
  }
}
