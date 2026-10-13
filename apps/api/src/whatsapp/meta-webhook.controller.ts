import { Controller, Get, Headers, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MetaSignatureService } from './meta-signature.service.js';
import { WhatsAppIngressService } from './whatsapp-ingress.service.js';

type RawRequest = FastifyRequest & { rawBody?: string };

@Controller('integrations/whatsapp/meta/webhook')
export class MetaWebhookController {
  constructor(
    @Inject(MetaSignatureService) private readonly signatures: MetaSignatureService,
    @Inject(WhatsAppIngressService) private readonly ingress: WhatsAppIngressService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!process.env.META_WEBHOOK_VERIFY_TOKEN || mode !== 'subscribe' || !challenge || token !== process.env.META_WEBHOOK_VERIFY_TOKEN) return reply.status(403).send('Forbidden');
    return reply.type('text/plain').send(challenge);
  }

  @Post()
  async receive(@Req() request: RawRequest, @Headers('x-hub-signature-256') signature: string | undefined) {
    const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});
    this.signatures.verify(Buffer.from(rawBody, 'utf8'), signature);
    return this.ingress.persist((request.body ?? {}) as Record<string, unknown>);
  }
}
