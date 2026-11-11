import { BadGatewayException, Injectable } from '@nestjs/common';

export type OutboundButton = { id: string; title: string };

@Injectable()
export class MetaCloudClient {
  private async post(phoneNumberId: string, recipientId: string, message: Record<string, unknown>) {
    const token = process.env.META_ACCESS_TOKEN;
    const version = process.env.META_GRAPH_API_VERSION ?? 'v26.0';
    if (!token) throw new BadGatewayException('META_ACCESS_TOKEN não configurado');
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipientId, ...message }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { code?: number; message?: string } } | null;
    if (!response.ok || !payload?.messages?.[0]?.id) {
      const error = new BadGatewayException(payload?.error?.message ?? `Meta respondeu HTTP ${response.status}`);
      Object.assign(error, { providerCode: payload?.error?.code, httpStatus: response.status });
      throw error;
    }
    return { providerMessageId: payload.messages[0].id };
  }

  sendText(phoneNumberId: string, recipientId: string, body: string) {
    return this.post(phoneNumberId, recipientId, { type: 'text', text: { preview_url: false, body } });
  }

  sendInteractive(phoneNumberId: string, recipientId: string, body: string, buttons: OutboundButton[]) {
    return this.post(phoneNumberId, recipientId, {
      type: 'interactive',
      interactive: { type: 'button', body: { text: body }, action: { buttons: buttons.map((button) => ({ type: 'reply', reply: { id: button.id, title: button.title } })) } },
    });
  }
}
