import { z } from 'zod';

export const emailAddress = z.email().max(254).transform(value => value.toLowerCase());
const flag = z.enum(['true', 'false']).transform(value => value === 'true');
export const TEST_RECIPIENTS = ['delivered@resend.dev', 'bounced@resend.dev', 'complained@resend.dev', 'suppressed@resend.dev'];

export function emailConfig(env: NodeJS.ProcessEnv = process.env) {
  const enabled = flag.parse(env.RESEND_ENABLED ?? 'false');
  const testMode = flag.parse(env.RESEND_TEST_MODE ?? 'true');
  const from = env.RESEND_FROM ?? 'GestãoNF <onboarding@resend.dev>';
  const sender = from.match(/^(?:[^<>\r\n]+ <)?([^<>\s]+@[^<>\s]+)>?$/)?.[1];
  if (!sender || from.length > 320 || !emailAddress.safeParse(sender).success) throw new Error('RESEND_FROM inválido');
  if (testMode && sender !== 'onboarding@resend.dev') throw new Error('Em testes, use onboarding@resend.dev');
  if (!testMode && sender.toLowerCase().endsWith('@resend.dev')) throw new Error('Produção exige remetente de domínio próprio verificado');
  const testRecipient = env.RESEND_TEST_RECIPIENT ? emailAddress.parse(env.RESEND_TEST_RECIPIENT) : null;
  const replyTo = env.RESEND_REPLY_TO ? emailAddress.parse(env.RESEND_REPLY_TO) : null;
  const apiKey = env.RESEND_API_KEY ?? '';
  if (enabled && !/^re_[^\s]+$/.test(apiKey)) throw new Error('Configure RESEND_API_KEY para ativar e-mails');
  if (enabled && testMode && !testRecipient) throw new Error('Configure RESEND_TEST_RECIPIENT com o e-mail da conta Resend');
  const webhookSecret = env.RESEND_WEBHOOK_SECRET ?? '';
  if (webhookSecret && !/^whsec_[A-Za-z0-9+/=]+$/.test(webhookSecret)) throw new Error('RESEND_WEBHOOK_SECRET inválido');
  const dailyLimit = z.coerce.number().int().min(1).max(10_000).parse(env.EMAIL_COMPANY_DAILY_LIMIT ?? '100');
  return { enabled, testMode, from, apiKey, testRecipient, replyTo, webhookSecret, dailyLimit };
}

export function allowedTestRecipient(address: string, config: ReturnType<typeof emailConfig>) {
  return address === config.testRecipient || TEST_RECIPIENTS.includes(address) || /^(delivered|bounced|complained)\+[a-z0-9_-]+@resend\.dev$/.test(address);
}
