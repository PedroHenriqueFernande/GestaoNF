import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { companies, companyUsers, storedFiles, users } from '@gestaonf/database/schema';
import { and, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.module.js';
import { CLEANUP_GRACE_MS, DOWNLOAD_TTL_SECONDS, FILE_TYPES, IMAGE_MAX_BYTES, MAX_PENDING_UPLOADS, PDF_MAX_BYTES, UPLOAD_TTL_SECONDS, EXTENSIONS, safeFileName, type FileMime } from './files.config.js';
import { validateFileContent } from './file-content.js';
import { InvalidStoredContent, ObjectNotUploaded, R2StorageService } from './r2-storage.service.js';
import type { BeginUpload, FileListQuery } from './files.schemas.js';

export type FileContext = { companyId: string; userId: string };
type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type FileDb = DatabaseService['db'] | Tx;
type StoredFile = typeof storedFiles.$inferSelect;

export function publicFile(row: StoredFile) {
  return { id: row.id, companyId: row.companyId, saleId: row.saleId, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes ?? row.expectedBytes,
    status: row.status, width: row.width, height: row.height, pageCount: row.pageCount, createdAt: row.createdAt, readyAt: row.readyAt };
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(R2StorageService) private readonly storage: R2StorageService) {}

  private async access(ctx: FileContext, db: FileDb = this.database.db) {
    const [member] = await db.select({ role: companyUsers.role }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId)).innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, ctx.companyId), eq(companyUsers.userId, ctx.userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).limit(1);
    if (!member) throw new ForbiddenException('Sem acesso ativo à empresa');
    return { ...ctx, manager: ['OWNER', 'ADMIN', 'MANAGER'].includes(member.role) };
  }
  private scope(a: Awaited<ReturnType<FilesService['access']>>) {
    // Attached documents follow the existing sale visibility (all active company members).
    return and(eq(storedFiles.companyId, a.companyId), a.manager ? sql`true` : or(eq(storedFiles.createdByUserId, a.userId), sql`${storedFiles.saleId} IS NOT NULL`))!;
  }
  private async file(ctx: FileContext, id: string, db: FileDb = this.database.db, lock = false) {
    const a = await this.access(ctx, db);
    const query = db.select().from(storedFiles).where(and(this.scope(a), eq(storedFiles.id, id))).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Arquivo não encontrado');
    return row;
  }
  async capabilities(ctx: FileContext) {
    await this.access(ctx);
    return { enabled: this.storage.enabled, mimeTypes: FILE_TYPES, imageMaxBytes: IMAGE_MAX_BYTES, pdfMaxBytes: PDF_MAX_BYTES, maxAttachments: 10, uploadTtlSeconds: UPLOAD_TTL_SECONDS };
  }
  async begin(ctx: FileContext, input: BeginUpload, key: string) {
    await this.access(ctx); this.storage.requireClient();
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const record = await this.database.db.transaction(async tx => {
      // Serialize reservations by company to keep concurrent uploads inside quota.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`files:quota:${ctx.companyId}`}, 0))`);
      await this.access(ctx, tx);
      const [previous] = await tx.select().from(storedFiles).where(and(eq(storedFiles.companyId, ctx.companyId), eq(storedFiles.createdByUserId, ctx.userId), eq(storedFiles.requestKey, key))).limit(1);
      if (previous) { if (previous.requestHash !== hash) throw new ConflictException('Chave de upload já utilizada com outro arquivo'); return previous; }
      const [usage] = await tx.select({ bytes: sql<number>`coalesce(sum(case when ${storedFiles.objectDeletedAt} is null and ${storedFiles.sizeBytes} is not null then ${storedFiles.sizeBytes} when ${storedFiles.status} = 'PENDING' and ${storedFiles.mimeType} <> 'application/pdf' then ${IMAGE_MAX_BYTES} when ${storedFiles.status} = 'PENDING' then ${storedFiles.expectedBytes} else 0 end), 0) + coalesce(sum(case when ${storedFiles.stagingCleanedAt} is null then ${storedFiles.expectedBytes} else 0 end), 0)`,
        pending: sql<number>`count(*) filter (where ${storedFiles.createdByUserId} = ${ctx.userId} and ${storedFiles.stagingCleanedAt} is null)` }).from(storedFiles).where(eq(storedFiles.companyId, ctx.companyId));
      if (Number(usage.pending) >= MAX_PENDING_UPLOADS) throw new ConflictException('Limite de uploads recentes atingido. Aguarde alguns minutos.');
      // Reserve up to the image cap to accommodate normalization; PDFs keep their original size.
      const reserved = input.sizeBytes + (input.mimeType === 'application/pdf' ? input.sizeBytes : IMAGE_MAX_BYTES);
      if (Number(usage.bytes) + reserved > this.storage.config!.companyQuotaBytes) throw new BadRequestException('Limite de armazenamento da empresa atingido');
      const id = randomUUID(), now = new Date();
      const [row] = await tx.insert(storedFiles).values({ id, companyId: ctx.companyId, createdByUserId: ctx.userId, requestKey: key, requestHash: hash,
        fileName: safeFileName(input.fileName, input.mimeType), mimeType: input.mimeType, expectedBytes: input.sizeBytes, bucket: this.storage.config!.bucket,
        stagingKey: `uploads/${ctx.companyId}/${id}/${randomUUID()}`, objectKey: `files/${ctx.companyId}/${id}/original.${EXTENSIONS[input.mimeType]}`,
        expiresAt: new Date(now.getTime() + UPLOAD_TTL_SECONDS * 1000), unattachedExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) }).returning();
      return row;
    });
    if (record.status === 'READY' && (!record.unattachedExpiresAt || record.unattachedExpiresAt.getTime() > Date.now())) return { file: publicFile(record), upload: null };
    if (record.status !== 'PENDING' || record.expiresAt.getTime() <= Date.now()) throw new GoneException('Upload expirado ou encerrado. Selecione o arquivo novamente.');
    try {
      const seconds = Math.max(1, Math.floor((record.expiresAt.getTime() - Date.now()) / 1000));
      const url = await this.storage.signUpload(record.bucket, record.stagingKey, record.mimeType, record.expectedBytes, seconds);
      return { file: publicFile(record), upload: { url, method: 'PUT' as const, headers: { 'Content-Type': record.mimeType, 'Cache-Control': 'private, no-store' }, expiresAt: record.expiresAt } };
    } catch (error) { this.unavailable('sign_upload', error); }
  }
  async complete(ctx: FileContext, id: string) {
    await this.file(ctx, id); this.storage.requireClient();
    let rejection: string | null = null;
    const result = await this.database.db.transaction(async tx => {
      const row = await this.file(ctx, id, tx, true);
      if (row.status === 'READY' && (!row.unattachedExpiresAt || row.unattachedExpiresAt.getTime() > Date.now())) return publicFile(row);
      if (row.status !== 'PENDING' || row.expiresAt.getTime() <= Date.now()) throw new GoneException('Upload expirado ou encerrado. Envie o arquivo novamente.');
      try {
        const object = await this.storage.head(row.bucket, row.stagingKey);
        if (object.sizeBytes !== row.expectedBytes || object.mimeType !== row.mimeType || !object.etag) throw new InvalidStoredContent('Tipo ou tamanho do arquivo diferente do informado');
        const uploaded = await this.storage.read(row.bucket, row.stagingKey, object.etag, row.expectedBytes);
        if (uploaded.body.length !== row.expectedBytes || uploaded.mimeType !== row.mimeType) throw new InvalidStoredContent('Conteúdo do upload inválido');
        const verified = await validateFileContent(uploaded.body, row.mimeType as FileMime);
        // Never expose the mutable staging key: accepted content is written to a different object.
        await this.storage.put(row.bucket, row.objectKey, verified.body, row.mimeType, row.fileName);
        const now = new Date();
        const [saved] = await tx.update(storedFiles).set({ status: 'READY', sizeBytes: verified.body.length, sha256: createHash('sha256').update(verified.body).digest('hex'),
          width: verified.width, height: verified.height, pageCount: verified.pageCount, readyAt: now, updatedAt: now }).where(eq(storedFiles.id, row.id)).returning();
        return publicFile(saved);
      } catch (error) {
        if (error instanceof ObjectNotUploaded) throw new ConflictException('O arquivo ainda não chegou. Conclua o upload e tente novamente.');
        if (error instanceof InvalidStoredContent) {
          rejection = error.message;
          await tx.update(storedFiles).set({ status: 'REJECTED', updatedAt: new Date() }).where(eq(storedFiles.id, id));
          return null;
        }
        this.unavailable('complete_upload', error);
      }
    });
    if (rejection) throw new BadRequestException(rejection);
    return result!;
  }
  async list(ctx: FileContext, query: FileListQuery) {
    const a = await this.access(ctx), conditions: SQL[] = [this.scope(a), eq(storedFiles.status, 'READY'), sql`(${storedFiles.unattachedExpiresAt} is null or ${storedFiles.unattachedExpiresAt} > now())`];
    if (query.kind === 'PDF') conditions.push(eq(storedFiles.mimeType, 'application/pdf'));
    if (query.kind === 'IMAGE') conditions.push(ilike(storedFiles.mimeType, 'image/%'));
    if (query.search) conditions.push(ilike(storedFiles.fileName, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`));
    const where = and(...conditions);
    const [rows, [total]] = await Promise.all([this.database.db.select().from(storedFiles).where(where).orderBy(desc(storedFiles.createdAt), desc(storedFiles.id)).limit(query.limit).offset(query.offset), this.database.db.select({ count: count() }).from(storedFiles).where(where)]);
    return { items: rows.map(publicFile), total: total.count, limit: query.limit, offset: query.offset };
  }
  async get(ctx: FileContext, id: string) { return publicFile(await this.file(ctx, id)); }
  async download(ctx: FileContext, id: string, disposition: 'inline' | 'attachment') {
    const row = await this.file(ctx, id);
    if (row.status !== 'READY' || (row.unattachedExpiresAt && row.unattachedExpiresAt.getTime() <= Date.now())) throw new GoneException('Arquivo indisponível');
    try {
      const url = await this.storage.signDownload(row.bucket, row.objectKey, row.fileName, row.mimeType, disposition === 'attachment', DOWNLOAD_TTL_SECONDS);
      return { url, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000), fileName: row.fileName };
    } catch (error) { this.unavailable('download', error); }
  }
  async remove(ctx: FileContext, id: string) {
    await this.database.db.transaction(async tx => {
      const row = await this.file(ctx, id, tx, true);
      if (row.saleId) throw new ConflictException('Remova este anexo pelo editor da venda e salve as alterações');
      if (['DELETING', 'DELETED'].includes(row.status)) return;
      await tx.update(storedFiles).set({ status: 'DELETING', deletedAt: new Date(), updatedAt: new Date() }).where(eq(storedFiles.id, id));
    });
    // Deletion is durable: worker retries transient R2 failures. No new download links after this point.
  }
  async syncSaleInTx(tx: Tx, ctx: FileContext, saleId: string, attachmentIds: string[] | undefined) {
    if (attachmentIds === undefined) return;
    const a = await this.access(ctx, tx);
    const rows = await tx.select().from(storedFiles).where(and(eq(storedFiles.companyId, ctx.companyId), or(eq(storedFiles.saleId, saleId), attachmentIds.length ? inArray(storedFiles.id, attachmentIds) : sql`false`))).orderBy(storedFiles.id).for('update');
    for (const id of attachmentIds) {
      const row = rows.find(file => file.id === id);
      if (!row || row.status !== 'READY' || (row.saleId && row.saleId !== saleId) || (!row.saleId && !a.manager && row.createdByUserId !== ctx.userId) || (row.unattachedExpiresAt && row.unattachedExpiresAt.getTime() <= Date.now())) throw new BadRequestException('Anexo inválido, indisponível ou de outra venda/empresa');
    }
    const now = new Date();
    for (const row of rows) {
      if (attachmentIds.includes(row.id)) await tx.update(storedFiles).set({ saleId, unattachedExpiresAt: null, updatedAt: now }).where(eq(storedFiles.id, row.id));
      else if (row.saleId === saleId) await tx.update(storedFiles).set({ saleId: null, status: 'DELETING', deletedAt: now, updatedAt: now }).where(eq(storedFiles.id, row.id));
    }
  }
  async cleanup(limit = 30) {
    if (!this.storage.enabled) return { cleaned: 0, failed: 0 };
    const due = or(and(isNull(storedFiles.stagingCleanedAt), lt(storedFiles.expiresAt, new Date(Date.now() - CLEANUP_GRACE_MS))), eq(storedFiles.status, 'DELETING'), and(eq(storedFiles.status, 'READY'), isNull(storedFiles.saleId), lt(storedFiles.unattachedExpiresAt, new Date())))!;
    const candidates = await this.database.db.select({ id: storedFiles.id }).from(storedFiles).where(due).orderBy(storedFiles.updatedAt).limit(limit);
    let cleaned = 0, failed = 0;
    for (const candidate of candidates) {
      try {
        const didClean = await this.database.db.transaction(async tx => {
          const [row] = await tx.select().from(storedFiles).where(and(eq(storedFiles.id, candidate.id), due)).for('update', { skipLocked: true }).limit(1);
          if (!row) return false;
          const now = new Date(), patch: Partial<typeof storedFiles.$inferInsert> = { updatedAt: now };
          if (!row.stagingCleanedAt && row.expiresAt.getTime() + CLEANUP_GRACE_MS < now.getTime()) {
            await this.storage.remove(row.bucket, row.stagingKey); patch.stagingCleanedAt = now;
          }
          const expired = row.status === 'READY' && !row.saleId && row.unattachedExpiresAt && row.unattachedExpiresAt < now;
          if (row.status === 'DELETING' || row.status === 'REJECTED' || row.status === 'PENDING' || expired) {
            if (!row.objectDeletedAt) { await this.storage.remove(row.bucket, row.objectKey); patch.objectDeletedAt = now; }
            if (row.status === 'DELETING') patch.status = 'DELETED';
            else if (row.status === 'PENDING' || expired) patch.status = 'EXPIRED';
          }
          await tx.update(storedFiles).set(patch).where(eq(storedFiles.id, row.id));
          return true;
        });
        if (didClean) cleaned++;
      } catch (error) { failed++; this.logger.warn({ event: 'file_cleanup_failed', fileId: candidate.id, errorType: error instanceof Error ? error.name : 'Unknown' }); }
    }
    return { cleaned, failed };
  }
  private unavailable(event: string, error: unknown): never {
    if (error instanceof ServiceUnavailableException) throw error;
    this.logger.warn({ event, errorType: error instanceof Error ? error.name : 'Unknown' });
    throw new ServiceUnavailableException('Não foi possível acessar o armazenamento. Tente novamente em instantes.');
  }
}
