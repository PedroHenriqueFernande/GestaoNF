import type { z } from 'zod';
import type { ToolPermission } from '../../permissions/actor.js';
import type { SupportToolDefinition } from '../llm/support-llm.client.js';
import type { SupportBlock } from '../support-blocks.js';
import type { SupportContext } from '../support-conversations.service.js';

export type ToolContext = SupportContext & { conversationId: string; messageId: string };
export type ToolResult = { output: Record<string, unknown>; blocks: SupportBlock[] };
export type ToolSpec<A> = {
  /** Permissão exigida (Spec 9). Filtra o que o modelo recebe e é conferida de novo na execução. */
  permission: ToolPermission;
  definition: SupportToolDefinition;
  /** Só quando o próprio esquema depende do usuário (destinos permitidos de `abrir_tela`). */
  forContext?(ctx: SupportContext): SupportToolDefinition;
  schema: z.ZodType<A>;
  run: (ctx: ToolContext, args: A) => Promise<ToolResult>;
};

export const issues = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`);
