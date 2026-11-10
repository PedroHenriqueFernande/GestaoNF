import type { z } from 'zod';
import type { SupportToolDefinition } from '../llm/support-llm.client.js';
import type { SupportBlock } from '../support-blocks.js';
import type { SupportContext } from '../support-conversations.service.js';

export type ToolContext = SupportContext & { conversationId: string; messageId: string };
export type ToolResult = { output: Record<string, unknown>; blocks: SupportBlock[] };
export type ToolSpec<A> = { definition: SupportToolDefinition; schema: z.ZodType<A>; run: (ctx: ToolContext, args: A) => Promise<ToolResult> };

export const issues = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`);
