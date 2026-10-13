import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Resend } from 'resend';
import { z } from 'zod';
import { emailConfig } from './emails.config.js';

export type EmailPayload = { from: string; to: string; subject: string; text: string; html: string; reply_to?: string };
export class EmailProviderError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly ambiguous: boolean, readonly retryAfterMs = 0) { super(code); }
}

@Injectable()
export class ResendProviderService {
  readonly config = emailConfig();
  private readonly verifier = new Resend(this.config.apiKey || 're_disabled');

  async send(payload: EmailPayload, idempotencyKey: string): Promise<string> {
    if (!this.config.enabled) throw new EmailProviderError('provider_disabled', false, false);
    // REST preserves the actual HTTP status and bounds network time; SDK verifies Svix signatures.
    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(payload),
      });
      const data: unknown = await response.json();
      if (response.ok) {
        const result = z.object({ id: z.uuid() }).safeParse(data);
        if (!result.success) throw new EmailProviderError('invalid_provider_response', true, true);
        return result.data.id;
      }
      const parsed = z.object({ name: z.string() }).safeParse(data);
      const knownCodes = ['validation_error', 'missing_api_key', 'restricted_api_key', 'invalid_permission', 'suspended_api_key', 'concurrent_idempotent_requests', 'invalid_idempotent_request', 'daily_quota_exceeded', 'monthly_quota_exceeded', 'rate_limit_exceeded', 'application_error', 'service_unavailable'];
      const code = parsed.success && knownCodes.includes(parsed.data.name) ? parsed.data.name : `http_${response.status}`;
      const retryable = response.status >= 500 || code === 'concurrent_idempotent_requests' || (response.status === 429 && code !== 'monthly_quota_exceeded');
      const retryHeader = response.headers.get('retry-after');
      let wait = retryHeader ? Number(retryHeader) * 1000 : 0;
      if (!Number.isFinite(wait) && retryHeader) wait = Date.parse(retryHeader) - Date.now();
      if (code === 'daily_quota_exceeded') { const reset = new Date(); reset.setUTCHours(24, 0, 0, 0); wait = Math.max(wait || 0, reset.getTime() - Date.now()); }
      throw new EmailProviderError(code, retryable, response.status >= 500, Math.max(0, Math.min(wait || 0, 24 * 60 * 60_000)));
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      throw new EmailProviderError('network_error', true, true);
    }
  }

  verifyWebhook(rawBody: string, headers: { id: string; timestamp: string; signature: string }) {
    if (!this.config.webhookSecret) throw new ServiceUnavailableException('Webhook Resend não configurado');
    try { return this.verifier.webhooks.verify({ payload: rawBody, headers, webhookSecret: this.config.webhookSecret }); }
    catch { throw new UnauthorizedException('Assinatura de webhook inválida'); }
  }
}
