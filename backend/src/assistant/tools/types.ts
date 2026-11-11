// backend/src/assistant/tools/types.ts
import type { z } from 'zod';
import type { DbExecutor } from '../db-types.js';
import type { ExecutionContext } from '../execution-context.js';

export type ToolControl = { kind: 'SWITCH_COMPANY'; companyName: string | null } | { kind: 'NEW_TOPIC' };

/** output vai para o modelo; memory é o resumo curto que fica no histórico da conversa. */
export type ToolResult = { output: Record<string, unknown>; memory: string; control?: ToolControl };

export type ReadTool = {
  kind: 'READ';
  name: string;
  description: string;
  /** JSON Schema estrito (strict: true na OpenAI): todos os campos em required e additionalProperties false. */
  parameters: Record<string, unknown>;
  allowed(ctx: ExecutionContext): boolean;
  run(ctx: ExecutionContext, args: unknown): Promise<ToolResult>;
};

export type OperationOptions = { idempotencyKey: string; dryRun: boolean };

/** `summary`: linha do resumo calculada no ensaio (com dados do banco); se ausente, usa `summarize`. */
export type OperationResult = { entityId: string | null; label: string; summary?: string };

export type WriteOperation<A = any> = {
  kind: 'WRITE';
  name: string;
  /** Descreve a operação e os campos de "dados" esperados, para o modelo. */
  description: string;
  schema: z.ZodType<A>;
  allowed(ctx: ExecutionContext): boolean;
  /** Uma linha em português, sem IDs. args ainda pode conter {"$ref": n}; labels são os rótulos das operações do lote. */
  summarize(args: Record<string, unknown>, labels: string[]): string;
  /**
   * Executa dentro da transação recebida. Em dryRun a transação é revertida depois;
   * operações com efeito externo (ex.: emissão fiscal) só validam quando dryRun = true.
   */
  execute(tx: DbExecutor, ctx: ExecutionContext, args: A, options: OperationOptions): Promise<OperationResult>;
};
