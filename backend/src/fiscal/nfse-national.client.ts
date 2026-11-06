import { Injectable } from '@nestjs/common';
import { request } from 'node:https';
import { gzipSync, gunzipSync } from 'node:zlib';

export class NationalTransportError extends Error {}
@Injectable()
export class NationalNfseClient {
  configuration() {
    const raw = process.env.NFSE_SEFIN_HOMOLOGATION_URL;
    if (!raw) throw new Error('Configure a URL da SEFIN de homologação conforme o contrato oficial.');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'sefin.producaorestrita.nfse.gov.br' || url.username || url.password || url.search || url.hash || url.port && url.port !== '443') throw new Error('URL de homologação inválida. Somente o host oficial de Produção Restrita é permitido.');
    return url.href.replace(/\/$/, '');
  }

  async call(method: 'GET' | 'POST', path: string, credential: { pfx: Buffer; passphrase: string }, xml?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    if (process.env.NFSE_HOMOLOGATION_ENABLED !== 'true' || process.env.NFSE_CONTRACT_CONFIRMED !== 'true') throw new Error('O envio em homologação precisa estar configurado e habilitado.');
    const url = new URL(`${this.configuration()}${path}`);
    const body = xml ? Buffer.from(JSON.stringify({ dpsXmlGZipB64: gzipSync(Buffer.from(xml, 'utf8')).toString('base64') })) : undefined;
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

export function nationalErrors(body: Record<string, unknown>) {
  if (!Array.isArray(body.erros)) return null;
  return body.erros.slice(0, 12).map((error: unknown) => {
    if (!error || typeof error !== 'object') return 'Erro fiscal não identificado.';
    const e = error as Record<string, unknown>;
    return [e.codigo, e.descricao, e.complemento].filter(v => typeof v === 'string').join(' — ').slice(0, 900);
  }).join('\n') || null;
}
