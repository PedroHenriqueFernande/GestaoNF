import { z } from 'zod';

export const FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type FileMime = typeof FILE_TYPES[number];
export const EXTENSIONS: Record<FileMime, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 600;
export const DOWNLOAD_TTL_SECONDS = 120;
export const CLEANUP_GRACE_MS = 60_000;
export const MAX_PENDING_UPLOADS = 20;
export const MAX_IMAGE_PIXELS = 40_000_000;

const configSchema = z.object({
  accountId: z.string().regex(/^[a-f0-9]{32}$/i),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  endpoint: z.url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && /^(?:[a-f0-9]{32})(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/i.test(url.hostname) && !url.username && !url.password && !url.search && !url.hash && ['/', ''].includes(url.pathname); }),
  companyQuotaBytes: z.coerce.number().int().min(PDF_MAX_BYTES).max(Number.MAX_SAFE_INTEGER),
});

export function readFilesConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.R2_ENABLED !== undefined && !['true', 'false'].includes(env.R2_ENABLED)) throw new Error('R2_ENABLED deve ser true ou false');
  if (env.R2_ENABLED !== 'true') return null;
  const result = configSchema.safeParse({ accountId: env.R2_ACCOUNT_ID, bucket: env.R2_BUCKET, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com`, companyQuotaBytes: env.R2_COMPANY_QUOTA_BYTES || 1024 * 1024 * 1024 });
  if (!result.success) throw new Error(`Configuração R2 inválida. Confira: ${[...new Set(result.error.issues.map(issue => String(issue.path[0])))].join(', ')}. Consulte apps/api/src/files/README.md.`);
  if (new URL(result.data.endpoint).hostname.split('.')[0].toLowerCase() !== result.data.accountId.toLowerCase()) throw new Error('R2_ENDPOINT não corresponde a R2_ACCOUNT_ID');
  return result.data;
}

export function maxFileBytes(mime: FileMime) { return mime === 'application/pdf' ? PDF_MAX_BYTES : IMAGE_MAX_BYTES; }
export function safeFileName(input: string, mime: FileMime) {
  const leaf = input.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const stem = leaf.replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\.[^.]*$/, '').trim().replace(/^\.+/, '').slice(0, 170).trim();
  return `${stem || 'arquivo'}.${EXTENSIONS[mime]}`;
}
export function contentDisposition(name: string, download: boolean) {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
