export const SUPPORT_LLM = Symbol('SUPPORT_LLM');

export type SupportToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};
export type SupportLlmToolCall = { callId: string; name: string; arguments: string };
export type SupportLlmRequest = { instructions: string; input: unknown[]; tools: SupportToolDefinition[] };
export type SupportLlmResponse = {
  /** Itens já normalizados por toHistoryItems: podem ser reenviados ao modelo e guardados no banco. */
  output: unknown[];
  text: string;
  toolCalls: SupportLlmToolCall[];
  usage: { inputTokens: number; outputTokens: number } | null;
};

export interface SupportLlmClient {
  readonly model: string;
  respond(request: SupportLlmRequest): Promise<SupportLlmResponse>;
}

export type SupportLlmErrorCode = 'AI_QUOTA' | 'AI_RATE_LIMIT' | 'AI_BAD_REQUEST' | 'AI_AUTH' | 'AI_UNAVAILABLE';

export class SupportLlmError extends Error {
  constructor(readonly code: SupportLlmErrorCode, readonly httpStatus: number | null, readonly requestId: string | null) {
    super(code);
    this.name = 'SupportLlmError';
  }
}

const quotaCodes = new Set(['insufficient_quota', 'credit_balance_exhausted','billing_hard_limit_reached', 'billing_not_active']);

export function toSupportLlmError(error: unknown): SupportLlmError {
  if (error instanceof SupportLlmError) return error;
  const raw = (error ?? {}) as { status?: unknown; code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown }; requestID?: unknown };
  const status = typeof raw.status === 'number' ? raw.status : null;
  const codes = [raw.code, raw.error?.code, raw.type, raw.error?.type].filter((value): value is string => typeof value === 'string');
  const requestId = typeof raw.requestID === 'string' ? raw.requestID : null;
  if (codes.some((code) => quotaCodes.has(code))) return new SupportLlmError('AI_QUOTA', status, requestId);
  if (status === 429) return new SupportLlmError('AI_RATE_LIMIT', status, requestId);
  if (status === 401 || status === 403) return new SupportLlmError('AI_AUTH', status, requestId);
  if (status === 400 || status === 404 || status === 422) return new SupportLlmError('AI_BAD_REQUEST', status, requestId);
  return new SupportLlmError('AI_UNAVAILABLE', status, requestId);
}

/** Preserva o raciocínio criptografado e a fase das mensagens para replay com store:false. */
export function toHistoryItems(output: unknown[]): unknown[] {
  const items: unknown[] = [];
  for (const raw of output as Array<Record<string, any>>) {
    if (raw?.type === 'reasoning' && typeof raw.encrypted_content === 'string') {
      items.push({ type: 'reasoning', id: raw.id, summary: Array.isArray(raw.summary) ? raw.summary : [], encrypted_content: raw.encrypted_content });
    } else if (raw?.type === 'function_call') {
      items.push({ type: 'function_call', call_id: raw.call_id, name: raw.name, arguments: raw.arguments });
    } else if (raw?.type === 'message' && raw.role === 'assistant') {
      const text = (Array.isArray(raw.content) ? raw.content : [])
        .filter((part: any) => part?.type === 'output_text')
        .map((part: any) => String(part.text ?? ''))
        .join('');
      if (text) items.push({ type: 'message', role: 'assistant', content: text, ...(raw.phase ? { phase: raw.phase } : {}) });
    }
  }
  return items;
}
