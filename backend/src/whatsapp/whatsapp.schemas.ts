import { z } from 'zod';

export const challengeIdSchema = z.object({ challengeId: z.uuid() }).strict();

export type MetaInboundMessage = {
  providerMessageId: string;
  phoneNumberId: string;
  senderId: string;
  senderName: string | null;
  messageType: string;
  text: string | null;
  payload: Record<string, unknown>;
};

export type MetaStatusUpdate = {
  phoneNumberId: string;
  providerMessageId: string;
  status: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

