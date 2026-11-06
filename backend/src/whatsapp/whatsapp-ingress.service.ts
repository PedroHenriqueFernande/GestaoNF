import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox, whatsappConnections, whatsappInboxEvents, whatsappOutboundMessages, whatsappStatusEvents } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import type { MetaInboundMessage, MetaStatusUpdate } from './whatsapp.schemas.js';

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

@Injectable()
export class WhatsAppIngressService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  parse(payload: Record<string, unknown>) {
    const messages: MetaInboundMessage[] = [];
    const statuses: MetaStatusUpdate[] = [];
    for (const entry of records(payload.entry)) for (const change of records(entry.changes)) {
      const value = object(change.value);
      const metadata = object(value?.metadata);
      const phoneNumberId = typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : '';
      const contacts = records(value?.contacts);
      const contactByWaId = new Map(contacts.map((contact) => {
        const profile = object(contact.profile);
        return [String(contact.wa_id ?? ''), typeof profile?.name === 'string' ? profile.name : null];
      }));
      for (const message of records(value?.messages)) {
        const textObject = object(message.text);
        const interactive = object(message.interactive);
        const buttonReply = object(interactive?.button_reply);
        const listReply = object(interactive?.list_reply);
        const text = typeof textObject?.body === 'string' ? textObject.body
          : typeof buttonReply?.title === 'string' ? buttonReply.title
          : typeof listReply?.title === 'string' ? listReply.title : null;
        const senderId = String(message.from ?? '');
        if (!phoneNumberId || !senderId || typeof message.id !== 'string') continue;
        messages.push({
          providerMessageId: message.id, phoneNumberId, senderId,
          senderName: contactByWaId.get(senderId) ?? null,
          messageType: typeof message.type === 'string' ? message.type : 'unknown', text,
          payload: message,
        });
      }
      for (const status of records(value?.statuses)) {
        if (!phoneNumberId || typeof status.id !== 'string' || typeof status.status !== 'string') continue;
        const timestamp = Number(status.timestamp);
        statuses.push({
          phoneNumberId, providerMessageId: status.id, status: status.status.toUpperCase(),
          occurredAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000) : new Date(), payload: status,
        });
      }
    }
    return { messages, statuses };
  }

  async persist(payload: Record<string, unknown>) {
    const parsed = this.parse(payload);
    for (const message of parsed.messages) {
      const [connection] = await this.database.db.select({ id: whatsappConnections.id }).from(whatsappConnections)
        .where(and(eq(whatsappConnections.phoneNumberId, message.phoneNumberId), eq(whatsappConnections.status, 'ACTIVE'))).limit(1);
      if (!connection) continue;
      await this.database.db.transaction(async (tx) => {
        const [event] = await tx.insert(whatsappInboxEvents).values({
          connectionId: connection.id, providerMessageId: message.providerMessageId, senderId: message.senderId,
          eventType: 'MESSAGE', messageType: message.messageType, messageText: message.text, payload: message.payload,
        }).onConflictDoNothing().returning({ id: whatsappInboxEvents.id });
        if (event) await tx.insert(integrationOutbox).values({ topic: 'whatsapp.inbound', aggregateId: event.id, payload: { inboxEventId: event.id } });
      });
    }
    for (const status of parsed.statuses) {
      const [connection] = await this.database.db.select({ id: whatsappConnections.id }).from(whatsappConnections)
        .where(eq(whatsappConnections.phoneNumberId, status.phoneNumberId)).limit(1);
      if (!connection) continue;
      await this.database.db.insert(whatsappStatusEvents).values({
        connectionId: connection.id, providerMessageId: status.providerMessageId, status: status.status,
        payload: status.payload, occurredAt: status.occurredAt,
      }).onConflictDoNothing();
      const update: Partial<typeof whatsappOutboundMessages.$inferInsert> = { updatedAt: new Date() };
      if (status.status === 'SENT') update.sentAt = status.occurredAt;
      if (status.status === 'DELIVERED') update.deliveredAt = status.occurredAt;
      if (status.status === 'READ') update.readAt = status.occurredAt;
      if (status.status === 'FAILED') update.failedAt = status.occurredAt;
      if (['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(status.status)) update.status = status.status;
      await this.database.db.update(whatsappOutboundMessages).set(update)
        .where(and(eq(whatsappOutboundMessages.connectionId, connection.id), eq(whatsappOutboundMessages.providerMessageId, status.providerMessageId)));
    }
    return { accepted: true, messages: parsed.messages.length, statuses: parsed.statuses.length };
  }
}

