// backend/src/assistant/model/nero-model.ts
import OpenAI from 'openai';

export type ModelItem = Record<string, unknown> & { type?: string };
export type ModelRequest = { instructions: string; input: unknown[]; tools: unknown[] };
export type ModelResponse = { output: ModelItem[]; outputText: string; usage: { input_tokens?: number; output_tokens?: number } | null };

export interface NeroModel {
  readonly name: string;
  enabled(): boolean;
  respond(request: ModelRequest): Promise<ModelResponse>;
}

export const NERO_MODEL = Symbol('NERO_MODEL');

export class OpenAINeroModel implements NeroModel {
  private client: OpenAI | null = null;
  get name() { return process.env.OPENAI_MODEL ?? 'gpt-6-luna'; }
  enabled() { return Boolean(process.env.OPENAI_API_KEY) && process.env.NILO_ENABLED === 'true'; }

  async respond(request: ModelRequest): Promise<ModelResponse> {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
    const response: any = await this.client.responses.create({
      model: this.name, instructions: request.instructions, input: request.input, tools: request.tools,
      parallel_tool_calls: false, store: false, include: ['reasoning.encrypted_content'],
    } as any);
    return { output: response.output ?? [], outputText: response.output_text ?? '', usage: response.usage ?? null };
  }
}
