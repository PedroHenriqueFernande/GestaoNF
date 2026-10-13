import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { contentDisposition, readFilesConfig, safeFileName } from '../src/files/files.config.js';
import { validateFileContent } from '../src/files/file-content.js';
import { R2StorageService } from '../src/files/r2-storage.service.js';

afterEach(() => vi.unstubAllEnvs());
describe('conteúdo e assinatura R2', () => {
  it('não exige credenciais quando desativado e falha claramente quando ativado incompleto', () => {
    expect(readFilesConfig({ R2_ENABLED: 'false' })).toBeNull();
    expect(() => readFilesConfig({ R2_ENABLED: 'true' })).toThrow('Configuração R2 inválida');
    expect(() => readFilesConfig({ R2_ENABLED: 'sim' })).toThrow('true ou false');
  });
  it('valida endpoint Cloudflare e correspondência da conta, sem aceitar endpoints arbitrários', () => {
    const env = { R2_ENABLED: 'true', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'private-files', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret' };
    expect(readFilesConfig(env)?.endpoint).toBe(`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    expect(readFilesConfig({ ...env, R2_ENDPOINT: `https://${'a'.repeat(32)}.eu.r2.cloudflarestorage.com` })?.endpoint).toContain('.eu.');
    expect(() => readFilesConfig({ ...env, R2_ENDPOINT: 'https://example.com' })).toThrow();
    expect(() => readFilesConfig({ ...env, R2_ENDPOINT: `https://${'b'.repeat(32)}.r2.cloudflarestorage.com` })).toThrow('não corresponde');
  });
  it('assina PUT com MIME/tamanho/cache, sem comunicação com R2, e GET com disposição privada', async () => {
    for (const [key, value] of Object.entries({ R2_ENABLED: 'true', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'private-files', R2_ACCESS_KEY_ID: 'testing-access-key', R2_SECRET_ACCESS_KEY: 'testing-secret-access-key', R2_ENDPOINT: '' })) vi.stubEnv(key, value);
    const storage = new R2StorageService();
    try {
      const upload = new URL(await storage.signUpload('private-files', 'uploads/company/id', 'image/png', 1024, 600));
      expect(upload.searchParams.get('X-Amz-Expires')).toBe('600');
      for (const header of ['content-type', 'content-length', 'cache-control', 'host']) expect(upload.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain(header);
      expect(upload.href).not.toContain('testing-secret-access-key');
      const download = new URL(await storage.signDownload('private-files', 'files/company/id', 'Contrato João.pdf', 'application/pdf', false, 120));
      expect(download.searchParams.get('X-Amz-Expires')).toBe('120');
      expect(download.searchParams.get('response-content-disposition')).toMatch(/^attachment;/);
      expect(download.searchParams.get('response-cache-control')).toBe('private, no-store');
    } finally { storage.onModuleDestroy(); }
  });
  it('normaliza nomes e não permite injeção de cabeçalhos', () => {
    expect(safeFileName('../../contrato.exe', 'application/pdf')).toBe('contrato.pdf');
    const name = safeFileName('foto\r\nX-Test: malware.png', 'image/png');
    expect(contentDisposition(name, true)).not.toMatch(/[\r\n]/);
    expect(contentDisposition('Contrato João.pdf', true)).toContain("filename*=UTF-8''Contrato%20Jo%C3%A3o.pdf");
  });
  it('decodifica PNG/JPEG, remove metadados e recusa conteúdo com MIME falso', async () => {
    const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#167a93' } }).png().toBuffer();
    expect(await validateFileContent(png, 'image/png')).toMatchObject({ width: 12, height: 8, pageCount: null });
    await expect(validateFileContent(png, 'image/jpeg')).rejects.toThrow('Imagem inválida');
    await expect(validateFileContent(Buffer.from('<html>fake</html>'), 'image/png')).rejects.toThrow('Imagem inválida');
    const jpeg = await sharp(png).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'private-value' } } }).toBuffer();
    const verified = await validateFileContent(jpeg, 'image/jpeg');
    expect((await sharp(verified.body).metadata()).exif).toBeUndefined();
  });
  it('preserva exatamente os bytes do PDF e recusa PDF corrompido/sem páginas', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const body = Buffer.from(await pdf.save());
    const result = await validateFileContent(body, 'application/pdf');
    expect(result.pageCount).toBe(1);
    expect(createHash('sha256').update(result.body).digest('hex')).toBe(createHash('sha256').update(body).digest('hex'));
    await expect(validateFileContent(Buffer.from('%PDF-fake'), 'application/pdf')).rejects.toThrow('PDF inválido');
    await expect(validateFileContent(Buffer.from('html'), 'application/pdf')).rejects.toThrow('não corresponde');
    const empty = Buffer.from(await (await PDFDocument.create()).save({ addDefaultPage: false }));
    await expect(validateFileContent(empty, 'application/pdf')).rejects.toThrow('PDF inválido');
  });
});
