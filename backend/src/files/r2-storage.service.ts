import { Injectable, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentDisposition, readFilesConfig } from './files.config.js';

export class InvalidStoredContent extends Error {}
export class ObjectNotUploaded extends Error {}

@Injectable()
export class R2StorageService implements OnModuleDestroy {
  readonly config = readFilesConfig();
  private readonly client = this.config ? new S3Client({ region: 'auto', endpoint: this.config.endpoint, credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2 }) : null;
  get enabled() { return !!this.config; }
  requireClient() {
    if (!this.client) throw new ServiceUnavailableException({ code: 'FILES_NOT_CONFIGURED', message: 'O envio de arquivos ainda não foi configurado.' });
    return this.client;
  }
  async signUpload(bucket: string, key: string, mimeType: string, sizeBytes: number, expiresIn: number) {
    // Explicitly sign Content-Type: getSignedUrl does not require it by default in every SDK release.
    return getSignedUrl(this.requireClient(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType, ContentLength: sizeBytes, CacheControl: 'private, no-store' }),
      { expiresIn, signableHeaders: new Set(['content-type', 'content-length', 'cache-control']) });
  }
  async head(bucket: string, key: string) {
    try {
      const object = await this.requireClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
      return { sizeBytes: object.ContentLength, mimeType: object.ContentType, etag: object.ETag };
    } catch (error) { if (isMissingObject(error)) throw new ObjectNotUploaded(); throw error; }
  }
  async read(bucket: string, key: string, etag: string, limit: number) {
    const abort = AbortSignal.timeout(30_000);
    const object = await this.requireClient().send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag }), { abortSignal: abort });
    if (!object.Body || !object.ContentLength || object.ContentLength > limit || object.ContentEncoding) {
      (object.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new InvalidStoredContent('Conteúdo ou tamanho inválido');
    }
    const body = object.Body as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
    const abortRead = () => body.destroy?.(new Error('R2 read timeout'));
    abort.addEventListener('abort', abortRead, { once: true });
    const chunks: Buffer[] = []; let length = 0;
    try {
      abort.throwIfAborted();
      for await (const chunk of body) {
        abort.throwIfAborted(); length += chunk.length;
        if (length > limit) throw new InvalidStoredContent('Arquivo acima do limite');
        chunks.push(Buffer.from(chunk));
      }
    } finally { abort.removeEventListener('abort', abortRead); body.destroy?.(); }
    return { body: Buffer.concat(chunks), mimeType: object.ContentType };
  }
  async put(bucket: string, key: string, body: Buffer, mimeType: string, fileName: string) {
    await this.requireClient().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mimeType, ContentLength: body.length,
      ContentDisposition: contentDisposition(fileName, mimeType === 'application/pdf'), CacheControl: 'private, no-store' }), { abortSignal: AbortSignal.timeout(30_000) });
  }
  async signDownload(bucket: string, key: string, fileName: string, mimeType: string, download: boolean, expiresIn: number) {
    return getSignedUrl(this.requireClient(), new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: mimeType,
      ResponseContentDisposition: contentDisposition(fileName, download || mimeType === 'application/pdf'), ResponseCacheControl: 'private, no-store' }), { expiresIn });
  }
  async remove(bucket: string, key: string) {
    await this.requireClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) });
  }
  onModuleDestroy() { this.client?.destroy(); }
}
function isMissingObject(error: unknown) {
  return typeof error === 'object' && error !== null && (('name' in error && ['NotFound', 'NoSuchKey'].includes(String(error.name))) || ('$metadata' in error && (error.$metadata as { httpStatusCode?: number })?.httpStatusCode === 404));
}
