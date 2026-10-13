import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

@Injectable()
export class EmailPayloadService {
  private readonly encodedKey = process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY ?? '';
  readonly keyId = process.env.EMAIL_PAYLOAD_ENCRYPTION_KEY_ID ?? 'v1';
  private readonly previousKeys: Record<string, string> = z.record(z.string(), z.string()).parse(JSON.parse(process.env.EMAIL_PAYLOAD_PREVIOUS_KEYS || '{}'));
  requireKey() {
    const key = Buffer.from(this.encodedKey, 'base64');
    if (key.length !== 32 || !/^[a-zA-Z0-9_-]{1,40}$/.test(this.keyId)) throw new ServiceUnavailableException('Proteção de convites não configurada');
    return key;
  }
  encrypt(content: { text: string; html: string }, context: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(content), 'utf8'), cipher.final()]);
    return { encryptedPayload: [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.'), encryptionKeyId: this.keyId };
  }
  decrypt(payload: string, keyId: string, context: string) {
    const key = keyId === this.keyId ? this.requireKey() : Buffer.from(this.previousKeys[keyId] ?? '', 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('Chave do envio indisponível');
    const [iv, tag, data] = payload.split('.');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return z.object({ text: z.string(), html: z.string() }).parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8')));
  }
}
