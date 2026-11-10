export const SUPPORT_CONFIG = Symbol('SUPPORT_CONFIG');

export type SupportConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  baseURL: string | undefined;
  dailyLimit: number;
};

export function supportConfig(env: Record<string, string | undefined> = process.env): SupportConfig {
  const apiKey = env.SUPPORT_OPENAI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || '';
  const dailyLimit = Number(env.SUPPORT_DAILY_MESSAGE_LIMIT);
  return {
    enabled: env.SUPPORT_AI_ENABLED === 'true' && apiKey.length > 0,
    apiKey,
    model: env.SUPPORT_AI_MODEL?.trim() || 'gpt-6-luna',
    baseURL: env.SUPPORT_AI_BASE_URL?.trim() || undefined,
    dailyLimit: Number.isInteger(dailyLimit) && dailyLimit > 0 ? dailyLimit : 100,
  };
}
