import { Redis } from 'ioredis';

export const WHATSAPP_INBOUND_QUEUE = 'whatsapp-inbound';
export const WHATSAPP_OUTBOUND_QUEUE = 'whatsapp-outbound';

export function redisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL não configurada');
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}
