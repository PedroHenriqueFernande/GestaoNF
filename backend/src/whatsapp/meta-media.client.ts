// backend/src/whatsapp/meta-media.client.ts
import { BadGatewayException, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

const META_MEDIA_HOSTS = ['fbsbx.com', 'facebook.com', 'whatsapp.net', 'fbcdn.net'];
const MAX_REDIRECTS = 3;

export class MediaRejectedError extends Error {
  constructor(readonly reason: 'TOO_LARGE' | 'INVALID') {
    super(reason === 'TOO_LARGE' ? 'Mídia acima do limite' : 'Mídia inválida ou fora da Meta');
    this.name = 'MediaRejectedError';
  }
}

/** Só HTTPS e domínios da Meta (o próprio domínio ou subdomínios dele). */
export function isMetaMediaUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && META_MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** O valor esperado pode vir em hex (64 caracteres) ou base64/base64url, com ou sem padding. */
function decodeSha256(expected: string) {
  const value = expected.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  if (!/^[A-Za-z0-9_+/-]+={0,2}$/.test(value)) return null;
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sha256Matches(bytes: Buffer, expected: string) {
  const digest = createHash('sha256').update(bytes).digest();
  const decoded = decodeSha256(expected);
  return decoded !== null && decoded.length === digest.length && timingSafeEqual(decoded, digest);
}

@Injectable()
export class MetaMediaClient {
  /** Baixa uma mídia recebida pelo webhook. O token só é enviado a hosts da Meta, inclusive após redirecionamento. */
  async download(mediaId: string, phoneNumberId: string, options: { maxBytes: number; sha256?: string | null }) {
    const token = process.env.META_ACCESS_TOKEN;
    const version = process.env.META_GRAPH_API_VERSION ?? 'v26.0';
    if (!token) throw new BadGatewayException('META_ACCESS_TOKEN não configurado');
    if (!/^\d+$/.test(mediaId)) throw new MediaRejectedError('INVALID');
    const authorization = { Authorization: `Bearer ${token}` };
    const infoResponse = await fetch(`https://graph.facebook.com/${version}/${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId)}`, { headers: authorization, signal: AbortSignal.timeout(15_000) });
    const info = await infoResponse.json().catch(() => null) as { url?: string; mime_type?: string; file_size?: number; sha256?: string } | null;
    if (!infoResponse.ok || !info?.url) throw new BadGatewayException(`Meta não informou a mídia (HTTP ${infoResponse.status})`);
    if (typeof info.file_size === 'number' && info.file_size > options.maxBytes) throw new MediaRejectedError('TOO_LARGE');

    let url = info.url;
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isMetaMediaUrl(url)) throw new MediaRejectedError('INVALID');
      response = await fetch(url, { headers: authorization, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) break;
      await response.body?.cancel().catch(() => {});
      url = new URL(location, url).toString();
      response = null;
    }
    if (!response || !response.ok || !response.body) {
      await response?.body?.cancel().catch(() => {});
      throw new BadGatewayException('Falha ao baixar a mídia da Meta');
    }
    if (Number(response.headers.get('content-length') ?? '0') > options.maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new MediaRejectedError('TOO_LARGE');
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > options.maxBytes) throw new MediaRejectedError('TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    const expected = options.sha256 ?? info.sha256 ?? null;
    if (expected && !sha256Matches(bytes, expected)) throw new MediaRejectedError('INVALID');
    return { bytes, mimeType: info.mime_type ?? null };
  }
}
