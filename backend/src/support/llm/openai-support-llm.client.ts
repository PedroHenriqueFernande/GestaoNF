import OpenAI from 'openai';
import type { SupportConfig } from '../support-config.js';
import { toHistoryItems, toSupportLlmError, type SupportLlmClient, type SupportLlmRequest, type SupportLlmResponse } from './support-llm.client.js';

export class OpenAiSupportLlmClient implements SupportLlmClient {
  private readonly client: OpenAI;
  private readonly retries: number;

  constructor(private readonly config: Pick<SupportConfig, 'apiKey' | 'model' | 'baseURL'>, options: { fetch?: typeof fetch; maxRetries?: number } = {}) {
    this.retries = Math.max(0, options.maxRetries ?? 1);
    // O SDK nunca repete sozinho (repetiria 429 e respeitaria retry-after longo); as novas tentativas são manuais em respond().
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 15_000,
      maxRetries: 0,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  get model() { return this.config.model; }

  async respond(request: SupportLlmRequest): Promise<SupportLlmResponse> {
    let response: any;
    for (let attempt = 0; ; attempt += 1) {
      try {
        response = await this.client.responses.create({
          model: this.config.model,
          instructions: request.instructions,
          input: request.input,
          tools: request.tools,
          parallel_tool_calls: false,
          store: false,
          include: ['reasoning.encrypted_content'],
          max_output_tokens: 500,
        } as any);
        break;
      } catch (error) {
        if (attempt >= this.retries || !isRetryable(error)) throw toSupportLlmError(error);
      }
    }
    const output = toHistoryItems(Array.isArray(response?.output) ? response.output : []);
    const text = output.filter((item: any) => item.role === 'assistant').map((item: any) => item.content as string).join('\n');
    const toolCalls = output.filter((item: any) => item.type === 'function_call')
      .map((item: any) => ({ callId: item.call_id as string, name: item.name as string, arguments: item.arguments as string }));
    const usage = response?.usage ? { inputTokens: Number(response.usage.input_tokens ?? 0), outputTokens: Number(response.usage.output_tokens ?? 0) } : null;
    return { output, text, toolCalls, usage };
  }
}

/** Repete só em 5xx ou falha de conexão/timeout (sem status numérico). 429 e demais 4xx nunca repetem. */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status !== 'number' || status >= 500;
}
