import 'reflect-metadata';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ResendProviderService, EmailProviderError } from '../src/emails/resend-provider.service.js';
import { renderEmail } from '../src/emails/email-template.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
async function main() {
  const provider = new ResendProviderService();
  if (!provider.config.enabled) { console.error('Ative RESEND_ENABLED e configure RESEND_API_KEY antes do teste.'); process.exitCode = 1; return; }
  const own = process.argv.includes('--own');
  const to = own ? provider.config.testRecipient : 'delivered@resend.dev';
  if (!to) { console.error('Configure RESEND_TEST_RECIPIENT para enviar à sua caixa de entrada.'); process.exitCode = 1; return; }
  const subject = 'Teste de conexão de e-mail do GestãoNF';
  const content = renderEmail('GestãoNF', subject, 'A infraestrutura de e-mail está conectada ao Resend. Este é um teste de envio.');
  await provider.send({ from: provider.config.from, to, subject, text: content.text, html: content.html, ...(provider.config.replyTo ? { reply_to: provider.config.replyTo } : {}) }, `gestaonf-check/${randomUUID()}`);
  console.log(own ? 'Resend aceitou o envio para o e-mail de testes configurado. Confira sua caixa de entrada.' : 'Resend aceitou o envio para delivered@resend.dev. Confira os eventos de simulação no painel.');
}
main().catch(error => { console.error(error instanceof EmailProviderError ? `Falha de conexão Resend: ${error.code}` : 'Verifique a configuração local do Resend.'); process.exitCode = 1; });
