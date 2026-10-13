import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { whatsappInboxEvents, whatsappOutboundMessages, whatsappRequests } from '@gestaonf/database/schema';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { WhatsAppLinkService } from '../whatsapp/whatsapp-link.service.js';
import { WhatsAppOutboundService } from '../whatsapp/whatsapp-outbound.service.js';

type Event = typeof whatsappInboxEvents.$inferSelect;
type Request = typeof whatsappRequests.$inferSelect;
type Identity = { id: string; userId: string };
const label = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

@Injectable()
export class CompanyRequestService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WhatsAppLinkService) private readonly links: WhatsAppLinkService,
    @Inject(WhatsAppOutboundService) private readonly outbound: WhatsAppOutboundService,
  ) {}

  private async say(event: Event, link: Identity, body: string, requestId?: string) {
    await this.outbound.enqueueText({ connectionId: event.connectionId, recipientId: event.senderId, linkId: link.id,
      logicalKey: `company-choice:${event.id}`, body, requestId });
  }

  private async ask(event: Event, link: Identity, request: Request) {
    const names = request.options.map((option, index) => `${index + 1} — ${option.name}`);
    await this.say(event, link, [
      `Para qual empresa devo atender esta solicitação?`,
      `“${request.messageText.slice(0, 160)}”`, '', ...names, '',
      `Responda o número da opção. Se houver vários pedidos em aberto, use ${request.selectionCode}-1 (substitua 1 pela opção).`,
    ].join('\n'), request.id);
  }

  async resolve(event: Event, link: Identity): Promise<Request | null> {
    const text = event.messageText!.trim();
    await this.database.db.update(whatsappRequests).set({ status: 'EXPIRED', updatedAt: new Date() })
      .where(and(eq(whatsappRequests.linkId, link.id), inArray(whatsappRequests.status, ['AWAITING_COMPANY', 'AWAITING_REPLY']), lt(whatsappRequests.expiresAt, new Date())));
    const [previous] = await this.database.db.select().from(whatsappRequests).where(eq(whatsappRequests.sourceInboxEventId, event.id)).limit(1);
    if (previous) {
      if (previous.status === 'AWAITING_COMPANY') { await this.ask(event, link, previous); return null; }
      return ['READY', 'PROCESSING', 'COMPLETED', 'AWAITING_REPLY'].includes(previous.status) ? previous : null;
    }
    const pending = await this.database.db.select().from(whatsappRequests)
      .where(and(eq(whatsappRequests.linkId, link.id), eq(whatsappRequests.userId, link.userId), inArray(whatsappRequests.status, ['AWAITING_COMPANY', 'AWAITING_REPLY'])))
      .orderBy(desc(whatsappRequests.createdAt));
    const explicit = text.match(/^([a-f0-9]{8})\s*[- ]\s*([1-9]\d*)$/i);
    const followup = text.match(/^([a-f0-9]{8}):\s*(.+)$/is);
    const number = text.match(/^(?:op[cç][aã]o\s+)?([1-9]\d*)[.)]?$/i);
    const context = event.payload.context as { id?: string } | undefined;
    let quotedId: string | undefined;
    if (context?.id) {
      const [message] = await this.database.db.select({ requestId: whatsappOutboundMessages.requestId }).from(whatsappOutboundMessages)
        .where(and(eq(whatsappOutboundMessages.connectionId, event.connectionId), eq(whatsappOutboundMessages.providerMessageId, context.id), eq(whatsappOutboundMessages.linkId, link.id))).limit(1);
      quotedId = message?.requestId ?? undefined;
    }
    const quoted = quotedId ? pending.find((request) => request.id === quotedId) : undefined;
    const target = followup ? pending.find((request) => request.selectionCode === followup[1].toUpperCase())
      : explicit ? pending.find((request) => request.selectionCode === explicit[1].toUpperCase())
      : quoted ?? (pending.length === 1 ? pending[0] : undefined);

    if (target?.status === 'AWAITING_REPLY' && (quoted || followup) && !/^novo\s+pedido\s*:/i.test(text) && !explicit && !number) {
      const [ready] = await this.database.db.update(whatsappRequests).set({ status: 'READY', expiresAt: new Date(Date.now() + 600_000), updatedAt: new Date() })
        .where(and(eq(whatsappRequests.id, target.id), eq(whatsappRequests.status, 'AWAITING_REPLY'))).returning();
      return ready ?? null;
    }
    if (target?.status === 'AWAITING_COMPANY') {
      const index = explicit ? Number(explicit[2]) - 1 : number ? Number(number[1]) - 1 : -1;
      const named = target.options.filter((option) => label(option.name) === label(text));
      const option = index >= 0 ? target.options[index] : named.length === 1 ? named[0] : undefined;
      if (option) {
        const eligible = await this.links.eligibleCompanies(link.id, link.userId);
        if (!eligible.some((item) => item.companyLinkId === option.companyLinkId)) {
          await this.database.db.update(whatsappRequests).set({ status: 'CANCELED', updatedAt: new Date() }).where(eq(whatsappRequests.id, target.id));
          await this.say(event, link, 'O vínculo ou o acesso à empresa escolhida foi removido. Envie sua solicitação novamente.');
          return null;
        }
        const [ready] = await this.database.db.update(whatsappRequests).set({ status: 'READY', companyId: option.companyId, companyLinkId: option.companyLinkId, selectedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(whatsappRequests.id, target.id), eq(whatsappRequests.status, 'AWAITING_COMPANY'))).returning();
        return ready ?? null;
      }
      if (explicit || number || named.length > 1) { await this.ask(event, link, target); return null; }
    }
    if (explicit || number || followup || (pending.length > 1 && pending.some((request) => request.options.some((option) => label(option.name) === label(text))))) {
      await this.say(event, link, pending.length > 1
        ? 'Há mais de uma solicitação aguardando empresa. Responda à pergunta específica ou use o código e a opção indicados nela.'
        : 'Essa seleção não está disponível ou expirou. Envie sua solicitação novamente.');
      return null;
    }
    const options = await this.links.eligibleCompanies(link.id, link.userId);
    if (!options.length) { await this.say(event, link, 'Este número não possui uma empresa vinculada com acesso ativo. Entre em Nero no GestãoNF e vincule a empresa por QR Code.'); return null; }
    const [request] = await this.database.db.insert(whatsappRequests).values({
      linkId: link.id, userId: link.userId, sourceInboxEventId: event.id,
      messageText: text.replace(/^novo\s+pedido\s*:\s*/i, ''), selectionCode: randomBytes(4).toString('hex').toUpperCase(), options,
      status: options.length === 1 ? 'READY' : 'AWAITING_COMPANY',
      companyId: options.length === 1 ? options[0].companyId : null,
      companyLinkId: options.length === 1 ? options[0].companyLinkId : null,
      selectedAt: options.length === 1 ? new Date() : null, expiresAt: new Date(Date.now() + 600_000),
    }).returning();
    if (request.status === 'AWAITING_COMPANY') { await this.ask(event, link, request); return null; }
    return request;
  }
}
