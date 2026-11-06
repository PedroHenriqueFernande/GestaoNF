import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox, whatsappOutboundMessages } from '@gestaonf/database/schema';
import { DatabaseService } from '../database/database.module.js';

@Injectable()
export class WhatsAppOutboundService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async enqueueText(input: {
    connectionId: string;
    recipientId: string;
    body: string;
    logicalKey: string;
    linkId?: string | null;
    companyId?: string | null;
    companyLinkId?: string | null;
    requestId?: string | null;
  }, transaction?: Pick<DatabaseService['db'], 'insert'>) {
    const insert = async (tx: Pick<DatabaseService['db'], 'insert'>) => {
      const [message] = await tx.insert(whatsappOutboundMessages).values({
        connectionId: input.connectionId, recipientId: input.recipientId, body: input.body,
        logicalKey: input.logicalKey, linkId: input.linkId ?? null, companyId: input.companyId ?? null,
        companyLinkId: input.companyLinkId ?? null, requestId: input.requestId ?? null,
      }).onConflictDoNothing({ target: whatsappOutboundMessages.logicalKey }).returning({ id: whatsappOutboundMessages.id });
      if (!message) return null;
      await tx.insert(integrationOutbox).values({ topic: 'whatsapp.outbound', aggregateId: message.id, payload: { outboundMessageId: message.id } });
      return message.id;
    };
    return transaction ? insert(transaction) : this.database.db.transaction(insert);
  }
}

