import { Injectable } from '@nestjs/common';
import { request } from 'node:https';
import { gzipSync, gunzipSync } from 'node:zlib';

export class NationalTransportError extends Error {}

/**
 * Event endpoints of the national API. The manual does not fix the JSON field names, so they are isolated here and must be
 * confirmed against the Swagger of the environment together with NFSE_CONTRACT_CONFIRMED before the first real transmission.
 */
export const EVENT_REQUEST_FIELD = 'pedidoRegistroEventoXmlGZipB64';
export const EVENT_RESPONSE_FIELD = 'eventoXmlGZipB64';
export const eventsPath = (accessKey: string) => `/nfse/${encodeURIComponent(accessKey)}/eventos`;
export const eventLookupPath = (accessKey: string, eventType: string) => `${eventsPath(accessKey)}/${encodeURIComponent(eventType)}`;
@Injectable()
export class NationalNfseClient {
  configuration() {
    const raw = process.env.NFSE_SEFIN_HOMOLOGATION_URL;
    if (!raw) throw new Error('Configure a URL da SEFIN de homologação conforme o contrato oficial.');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'sefin.producaorestrita.nfse.gov.br' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443') throw new Error('URL de homologação inválida. Somente o host oficial de Produção Restrita é permitido.');
    return url.href.replace(/\/$/, '');
  }

  async call(method: 'GET' | 'POST', path: string, credential: { pfx: Buffer; passphrase: string }, xml?: string, bodyField = 'dpsXmlGZipB64', probe = false): Promise<{ status: number; body: Record<string, unknown> }> {
    // A read-only probe is how the URL and certificate get verified in the first place, so it does not require the contract to be confirmed yet.
    if (!probe && (process.env.NFSE_HOMOLOGATION_ENABLED !== 'true' || process.env.NFSE_CONTRACT_CONFIRMED !== 'true')) throw new Error('O envio em homologação precisa estar configurado e habilitado.');
    const url = new URL(`${this.configuration()}${path}`);
    const body = xml ? Buffer.from(JSON.stringify({ [bodyField]: gzipSync(Buffer.from(xml, 'utf8')).toString('base64') })) : undefined;
    return new Promise((resolve, reject) => {
      const req = request(url, { method, pfx: credential.pfx, passphrase: credential.passphrase, minVersion: 'TLSv1.2', rejectUnauthorized: true, agent: false,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}) } }, response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 3 * 1024 * 1024) req.destroy(new NationalTransportError('Resposta fiscal acima do limite.')); else chunks.push(chunk); });
        response.on('aborted', () => req.destroy(new NationalTransportError('Resposta fiscal interrompida.')));
        response.on('error', () => req.destroy(new NationalTransportError('Falha ao receber a resposta fiscal.')));
        response.on('end', () => {
          clearTimeout(timer);
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            const parsed: unknown = text ? JSON.parse(text) : {};
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
            resolve({ status: response.statusCode ?? 0, body: parsed as Record<string, unknown> });
          } catch { reject(new NationalTransportError('O ambiente nacional retornou uma resposta que não pôde ser interpretada. Consulte o resultado antes de reenviar.')); }
        });
      });
      const timer = setTimeout(() => req.destroy(new NationalTransportError('A comunicação fiscal excedeu o prazo. O resultado será consultado.')), 45000);
      req.setTimeout(10000, () => req.destroy(new NationalTransportError('A conexão fiscal excedeu o prazo.')));
      req.on('error', error => { clearTimeout(timer); reject(error instanceof NationalTransportError ? error : new NationalTransportError('Falha na conexão com o ambiente nacional.')); });
      if (body) req.write(body);
      req.end();
    });
  }
}

export function extractOfficialXml(body: Record<string, unknown>): string | null {
  const value = body.nfseXmlGZipB64;
  if (typeof value !== 'string') return null;
  if (value.length > 3 * 1024 * 1024 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value)) throw new Error('Documento fiscal compactado inválido.');
  return gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: 2 * 1024 * 1024 }).toString('utf8');
}

/** Reads the registered event from a response, either direct or as the first item of a list. */
export function extractEventXml(body: Record<string, unknown>): string | null {
  const direct = body[EVENT_RESPONSE_FIELD];
  const listed = Array.isArray(body.eventos) ? (body.eventos[0] as Record<string, unknown> | undefined)?.[EVENT_RESPONSE_FIELD] : undefined;
  const value = typeof direct === 'string' ? direct : listed;
  if (typeof value !== 'string') return null;
  if (value.length > 3 * 1024 * 1024 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value)) throw new Error('Evento fiscal compactado inválido.');
  return gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: 2 * 1024 * 1024 }).toString('utf8');
}

/** Case-insensitive lookup: the Swagger of the environment is the only authority on field names, so be tolerant. */
function field(source: Record<string, unknown>, ...names: string[]): unknown {
  const key = Object.keys(source).find(candidate => names.includes(candidate.toLowerCase()));
  return key === undefined ? undefined : source[key];
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

function describeError(item: unknown): string {
  if (typeof item === 'string') return item.slice(0, 900);
  if (!item || typeof item !== 'object') return 'Erro fiscal não identificado.';
  const entry = item as Record<string, unknown>;
  const parts = [field(entry, 'codigo', 'code', 'cod'), field(entry, 'descricao', 'description', 'mensagem', 'message'), field(entry, 'complemento', 'detalhe', 'detail')].flatMap(value => text(value) ?? []);
  return (parts.length ? parts.join(' — ') : JSON.stringify(entry)).slice(0, 900);
}

/** Extracts the rejection reasons from a response body; null when the body carries none. */
export function nationalErrors(body: Record<string, unknown>) {
  const raw = field(body, 'erros', 'erro', 'errors', 'error');
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const lines = list.slice(0, 12).map(describeError);
  if (lines.length) return lines.join('\n');
  const generic = [field(body, 'title'), field(body, 'mensagem', 'message'), field(body, 'detail', 'detalhe')].flatMap(value => text(value) ?? []);
  return generic.length ? generic.join(' — ').slice(0, 900) : null;
}

/**
 * How to treat an HTTP answer to a transmission:
 * - REJECTED: the environment read the request and refused it on its merits (400/422 and other 4xx).
 * - NOT_PROCESSED: gateway-level refusal (401/403/404): wrong URL, certificate or permission. Nothing was processed, so it is safe to try again after fixing the setup.
 * - UNCERTAIN: anything that might have been processed (timeouts, conflicts, throttling, 5xx).
 */
export function classifyResponse(status: number): 'REJECTED' | 'NOT_PROCESSED' | 'UNCERTAIN' {
  if (status === 401 || status === 403 || status === 404) return 'NOT_PROCESSED';
  if (status === 408 || status === 409 || status === 429) return 'UNCERTAIN';
  return status >= 400 && status < 500 ? 'REJECTED' : 'UNCERTAIN';
}

export const transportRefusal = (status: number) => `O ambiente nacional recusou a requisição antes de processá-la (HTTP ${status}). Nada foi emitido. Confira a URL base, o certificado e as permissões e use "Retomar processamento".`;
export const rawBodySummary = (status: number, body: Record<string, unknown>) => `HTTP ${status}: ${JSON.stringify(body).slice(0, 600)}`;
