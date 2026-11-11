import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { integrationOutbox, whatsappOutboundMessages } from '@gestaonf/database/schema';
import { DatabaseService } from '../database/database.module.js';
import type { OutboundButton } from './meta-cloud.client.js';

type Executor = Pick<DatabaseService['db'], 'insert'>;
export type OutboundInput = {
  connectionId: string;
  recipientId: string;
  body: string;
  logicalKey: string;
  linkId?: string | null;
  companyId?: string | null;
  companyLinkId?: string | null;
  requestId?: string | null;
  conversationId?: string | null;
};

@Injectable()
export class WhatsAppOutboundService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async enqueue(input: OutboundInput & { messageType: 'TEXT' | 'INTERACTIVE'; buttons?: OutboundButton[] }, transaction?: Executor) {
    const insert = async (tx: Executor) => {
      const [message] = await tx.insert(whatsappOutboundMessages).values({
        connectionId: input.connectionId, recipientId: input.recipientId, body: input.body, messageType: input.messageType,
        interactive: input.buttons ? { buttons: input.buttons } : null,
        logicalKey: input.logicalKey, linkId: input.linkId ?? null, companyId: input.companyId ?? null,
        companyLinkId: input.companyLinkId ?? null, requestId: input.requestId ?? null, conversationId: input.conversationId ?? null,
      }).onConflictDoNothing({ target: whatsappOutboundMessages.logicalKey }).returning({ id: whatsappOutboundMessages.id });
      if (!message) return null;
      await tx.insert(integrationOutbox).values({ topic: 'whatsapp.outbound', aggregateId: message.id, payload: { outboundMessageId: message.id } });
      return message.id;
    };
    return transaction ? insert(transaction) : this.database.db.transaction(insert);
  }

  enqueueText(input: OutboundInput, transaction?: Executor) {
    return this.enqueue({ ...input, messageType: 'TEXT' }, transaction);
  }

  /** Mensagem com até 3 botões de resposta (limites da Meta: corpo 1024, título 20, id 256). */
  async enqueueInteractive(input: OutboundInput & { buttons: OutboundButton[] }, transaction?: Executor) {
    if (input.buttons.length < 1 || input.buttons.length > 3) throw new BadRequestException('Use de 1 a 3 botões');
    if (input.body.length > 1024) throw new BadRequestException('Texto da mensagem com botões acima de 1024 caracteres');
    if (input.buttons.some((button) => !button.title.trim() || button.title.length > 20 || !button.id || button.id.length > 256)) throw new BadRequestException('Botão inválido');
    if (new Set(input.buttons.map((button) => button.id)).size !== input.buttons.length || new Set(input.buttons.map((button) => button.title.trim().toLowerCase())).size !== input.buttons.length) throw new BadRequestException('Botões repetidos');
    return this.enqueue({ ...input, messageType: 'INTERACTIVE' }, transaction);
  }
}
