import { Inject, Injectable, Logger } from '@nestjs/common';
import { companies } from '@gestaonf/database/schema';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { SupportHelpCatalog } from './help-catalog.js';
import { SUPPORT_LLM, SupportLlmError, type SupportLlmClient } from './llm/support-llm.client.js';
import { SUPPORT_CONFIG, type SupportConfig } from './support-config.js';
import type { SupportBlock } from './support-blocks.js';
import { SupportConversationsService, type SupportContext } from './support-conversations.service.js';
import { buildSupportInstructions } from './support-instructions.js';
import { SupportToolRegistry } from './tools/tool-registry.js';

const MAX_ROUNDS = 4;
const HISTORY_MESSAGES = 10;
const EXHAUSTED = 'Não consegui concluir. Tente reformular ou use os atalhos.';
const EMPTY = 'Não consegui responder. Tente reformular ou use os atalhos.';
const UNAVAILABLE = 'O assistente está indisponível no momento. Os atalhos continuam funcionando.';

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SupportConversationsService) private readonly conversations: SupportConversationsService,
    @Inject(SupportToolRegistry) private readonly registry: SupportToolRegistry,
    @Inject(SupportHelpCatalog) private readonly catalog: SupportHelpCatalog,
    @Inject(SUPPORT_LLM) private readonly llm: SupportLlmClient | null,
    @Inject(SUPPORT_CONFIG) private readonly config: SupportConfig,
  ) {}

  async send(ctx: SupportContext, text: string) {
    const [company] = await this.database.db.select({ name: companies.name, timezone: companies.timezone }).from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    const timezone = company?.timezone ?? 'America/Sao_Paulo';
    const conversation = await this.conversations.activeOrCreate(ctx);
    const history = await this.conversations.history(conversation.id, HISTORY_MESSAGES);
    const userMessage = await this.conversations.addUserMessageWithinDailyLimit(ctx, conversation.id, text, timezone, this.config.dailyLimit);
    const assistantId = await this.conversations.startAssistantMessage(ctx, conversation.id, this.llm?.model ?? null);

    if (!this.llm) {
      const assistant = await this.conversations.finishAssistantMessage(assistantId, {
        blocks: [{ type: 'notice', level: 'info', text: 'O chat com IA está desativado. Use os atalhos abaixo.' }],
        llmItems: [], inputTokens: null, outputTokens: null, toolCallCount: 0, errorCode: 'AI_DISABLED',
      });
      return { messages: [userMessage, assistant] };
    }

    const produced: unknown[] = [];
    let blocks: SupportBlock[] = [];
    let finalText: string | null = null;
    let inputTokens = 0, outputTokens = 0, toolCallCount = 0, sawUsage = false;

    try {
      const instructions = buildSupportInstructions({
        topics: this.catalog.list(), companyName: company?.name ?? 'Empresa',
        today: new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date()),
      });
      const toolContext = { ...ctx, conversationId: conversation.id, messageId: assistantId };
      const base: unknown[] = [...history, { role: 'user', content: text }];
      const tools = this.registry.definitions();
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const response = await this.llm.respond({ instructions, input: [...base, ...produced], tools });
        produced.push(...response.output);
        if (response.usage) { sawUsage = true; inputTokens += response.usage.inputTokens; outputTokens += response.usage.outputTokens; }
        if (!response.toolCalls.length) { finalText = response.text.trim(); break; }
        for (const toolCall of response.toolCalls) {
          toolCallCount += 1;
          const result = await this.registry.run(toolContext, toolCall.name, toolCall.arguments);
          blocks.push(...result.blocks);
          produced.push({ type: 'function_call_output', call_id: toolCall.callId, output: JSON.stringify(result.output) });
        }
      }
    } catch (raw) {
      // O client sempre lança SupportLlmError; qualquer outra coisa é falha interna (banco, tool, montagem do pedido).
      let errorCode: string;
      if (raw instanceof SupportLlmError) {
        errorCode = raw.code;
        this.logger.warn(`support_llm_error code=${raw.code} status=${raw.httpStatus ?? 'none'} request=${raw.requestId ?? 'none'}`);
      } else {
        errorCode = 'INTERNAL_ERROR';
        const name = (raw as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'unknown';
        this.logger.error(`support_chat_internal_error error=${name} code=${(raw as { code?: unknown } | null)?.code ?? 'none'}`);
      }
      const assistant = await this.conversations.finishAssistantMessage(assistantId, {
        blocks: [{ type: 'notice', level: 'error', text: UNAVAILABLE }, ...keepLastAction(blocks)],
        llmItems: [], inputTokens: sawUsage ? inputTokens : null, outputTokens: sawUsage ? outputTokens : null, toolCallCount, errorCode,
      });
      return { messages: [userMessage, assistant] };
    }

    blocks = keepLastAction(blocks);
    const reply = finalText === null ? EXHAUSTED : finalText === '' && !blocks.length ? EMPTY : finalText;
    const closeWithReply = finalText === null || reply === EMPTY;
    const assistant = await this.conversations.finishAssistantMessage(assistantId, {
      blocks: [...(reply ? [{ type: 'text' as const, text: reply }] : []), ...blocks],
      llmItems: closeWithReply ? [...produced, { role: 'assistant', content: reply }] : produced,
      inputTokens: sawUsage ? inputTokens : null, outputTokens: sawUsage ? outputTokens : null, toolCallCount, errorCode: null,
    });
    return { messages: [userMessage, assistant] };
  }
}

function keepLastAction(blocks: SupportBlock[]) {
  const last = blocks.filter((block) => block.type === 'action').at(-1);
  return blocks.filter((block) => block.type !== 'action' || block === last);
}
