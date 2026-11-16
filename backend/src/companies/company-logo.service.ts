import { BadRequestException, ConflictException, GoneException, HttpException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { companies, companyLogoFiles, companyUsers } from '@gestaonf/database/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { companyAvailable } from '../accounts/account-policy.js';
import { DatabaseService } from '../database/database.module.js';
import { COMPANY_LOGO_IMAGE, normalizeImage, type BeginImageUpload } from '../files/image-normalize.js';
import { InvalidStoredContent, ObjectNotUploaded, R2StorageService } from '../files/r2-storage.service.js';
import { assertCompanyManager } from './company-access.js';

export type LogoContext = { companyId: string; userId: string };
type LogoFile = typeof companyLogoFiles.$inferSelect;

const UPLOAD_TTL_MS = 600_000;
const READY_TTL_MS = 86_400_000;
const ACCESS_TTL_SECONDS = 120;
const MAX_PENDING = 3;
const MAX_PER_MINUTE = 5;
const EXPIRED_READY = 'Foto pronta expirada. Selecione a imagem novamente.';
const EXPIRED_UPLOAD = 'Upload expirado ou encerrado. Selecione a imagem novamente.';

const publicFile = (f: LogoFile) => ({ id: f.id, status: f.status, mimeType: f.mimeType, width: f.width, height: f.height, sizeBytes: f.sizeBytes,
  thumbnail: f.thumbWidth ? { width: f.thumbWidth, height: f.thumbHeight, sizeBytes: f.thumbSizeBytes } : null });

@Injectable()
export class CompanyLogoService {
  private readonly logger = new Logger(CompanyLogoService.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(R2StorageService) private readonly storage: R2StorageService) {}

  async begin(ctx: LogoContext, input: BeginImageUpload, key: string) {
    this.storage.requireClient();
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const row = await this.database.db.transaction(async tx => {
      // Serializa reservas por empresa para os limites valerem sob concorrência.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`company-logo:reserve:${ctx.companyId}`}, 0))`);
      await assertCompanyManager(tx, ctx.companyId, ctx.userId);
      const [existing] = await tx.select().from(companyLogoFiles).where(and(eq(companyLogoFiles.companyId, ctx.companyId), eq(companyLogoFiles.createdByUserId, ctx.userId), eq(companyLogoFiles.requestKey, key))).limit(1);
      if (existing) { if (existing.requestHash !== hash) throw new ConflictException('Chave de upload já utilizada com outro arquivo'); return existing; }
      const [current] = await tx.select({ logoId: companies.logoId }).from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
      const [limits] = await tx.select({
        pending: sql<number>`count(*) filter (where ${companyLogoFiles.id} is distinct from ${current?.logoId ?? null}::uuid and (${companyLogoFiles.stagingCleanedAt} is null or ${companyLogoFiles.objectDeletedAt} is null))`,
        recent: sql<number>`count(*) filter (where ${companyLogoFiles.createdAt} > now() - interval '1 minute')`,
      }).from(companyLogoFiles).where(eq(companyLogoFiles.companyId, ctx.companyId));
      if (Number(limits.pending) >= MAX_PENDING || Number(limits.recent) >= MAX_PER_MINUTE) throw new HttpException('Limite de envios de foto atingido. Aguarde alguns minutos.', 429);
      const id = randomUUID(), now = new Date(), base = `company-logos/${ctx.companyId}/${id}`;
      const [created] = await tx.insert(companyLogoFiles).values({ id, companyId: ctx.companyId, createdByUserId: ctx.userId, requestKey: key, requestHash: hash,
        inputMimeType: input.mimeType, expectedBytes: input.sizeBytes, bucket: this.storage.config!.bucket,
        stagingKey: `uploads/company-logos/${ctx.companyId}/${id}/${randomUUID()}`, objectKey: `${base}/logo.webp`, thumbObjectKey: `${base}/logo-128.webp`,
        status: 'PENDING', uploadExpiresAt: new Date(now.getTime() + UPLOAD_TTL_MS) }).returning();
      return created;
    });
    if (row.status === 'READY' && row.unattachedExpiresAt && row.unattachedExpiresAt <= new Date()) throw new GoneException(EXPIRED_READY);
    if (row.status === 'READY' || row.status === 'ACTIVE') return { file: { id: row.id, status: row.status }, upload: null };
    if (row.status !== 'PENDING' || row.uploadExpiresAt <= new Date()) throw new GoneException(EXPIRED_UPLOAD);
    try {
      const seconds = Math.max(1, Math.floor((row.uploadExpiresAt.getTime() - Date.now()) / 1000));
      const url = await this.storage.signUpload(row.bucket, row.stagingKey, row.inputMimeType, row.expectedBytes, seconds);
      return { file: { id: row.id, status: row.status }, upload: { url, method: 'PUT' as const, headers: { 'Content-Type': row.inputMimeType, 'Cache-Control': 'private, no-store' }, expiresAt: row.uploadExpiresAt.toISOString() } };
    } catch (error) { this.unavailable('company_logo_sign_upload', { ...ctx, fileId: row.id }, error); }
  }

  async complete(ctx: LogoContext, id: string) {
    this.storage.requireClient();
    let rejection: string | null = null;
    const result = await this.database.db.transaction(async tx => {
      await assertCompanyManager(tx, ctx.companyId, ctx.userId);
      const [row] = await tx.select().from(companyLogoFiles).where(this.own(ctx, id)).for('update').limit(1);
      if (!row) throw new NotFoundException('Foto não encontrada');
      if (row.status === 'READY' && row.unattachedExpiresAt && row.unattachedExpiresAt <= new Date()) throw new GoneException(EXPIRED_READY);
      if (row.status === 'READY' || row.status === 'ACTIVE') return { file: publicFile(row), expiresAt: row.unattachedExpiresAt?.toISOString() ?? null };
      if (row.status !== 'PENDING' || row.uploadExpiresAt <= new Date()) throw new GoneException(EXPIRED_UPLOAD);
      try {
        const head = await this.storage.head(row.bucket, row.stagingKey);
        if (head.sizeBytes !== row.expectedBytes || head.mimeType !== row.inputMimeType || !head.etag) throw new InvalidStoredContent('Tipo ou tamanho diferente do declarado');
        const read = await this.storage.read(row.bucket, row.stagingKey, head.etag, row.expectedBytes);
        if (read.body.length !== row.expectedBytes || read.mimeType !== row.inputMimeType) throw new InvalidStoredContent('Upload incompleto ou alterado');
        const [main, thumb] = await normalizeImage(read.body, row.inputMimeType, COMPANY_LOGO_IMAGE);
        // O temporário nunca é servido: as variantes aceitas vão para chaves próprias.
        await this.storage.put(row.bucket, row.objectKey, main.body, 'image/webp', 'logo.webp');
        await this.storage.put(row.bucket, row.thumbObjectKey, thumb.body, 'image/webp', 'logo-128.webp');
        const now = new Date();
        const [saved] = await tx.update(companyLogoFiles).set({ status: 'READY', mimeType: 'image/webp', sizeBytes: main.body.length, width: main.width, height: main.height,
          sha256: createHash('sha256').update(main.body).digest('hex'), thumbSizeBytes: thumb.body.length, thumbWidth: thumb.width, thumbHeight: thumb.height,
          readyAt: now, unattachedExpiresAt: new Date(now.getTime() + READY_TTL_MS), updatedAt: now }).where(eq(companyLogoFiles.id, row.id)).returning();
        return { file: publicFile(saved), expiresAt: saved.unattachedExpiresAt!.toISOString() };
      } catch (error) {
        if (error instanceof ObjectNotUploaded) throw new ConflictException('A imagem ainda não chegou. Conclua o envio e tente novamente.');
        if (error instanceof InvalidStoredContent) {
          rejection = error.message;
          await tx.update(companyLogoFiles).set({ status: 'REJECTED', updatedAt: new Date() }).where(eq(companyLogoFiles.id, row.id));
          return null;
        }
        this.unavailable('company_logo_complete', { ...ctx, fileId: id }, error);
      }
    });
    if (rejection) {
      this.logger.log({ event: 'company_logo_rejected', ...ctx, fileId: id, reason: rejection });
      throw new BadRequestException(rejection);
    }
    return result!;
  }

  private own(ctx: LogoContext, id: string) {
    return and(eq(companyLogoFiles.id, id), eq(companyLogoFiles.companyId, ctx.companyId), eq(companyLogoFiles.createdByUserId, ctx.userId))!;
  }

  async setLogo(ctx: LogoContext, logoId: string | null) {
    const outcome = await this.database.db.transaction(async tx => {
      // Mesma ordem de travas de CompaniesService.update: empresa primeiro, depois arquivos por ID.
      await tx.execute(sql`select id from companies where id = ${ctx.companyId} for update`);
      const { role } = await assertCompanyManager(tx, ctx.companyId, ctx.userId);
      const [company] = await tx.select().from(companies).where(and(eq(companies.id, ctx.companyId), eq(companies.status, 'ACTIVE'))).limit(1);
      if (!company) throw new NotFoundException('Empresa não encontrada');
      if (company.logoId === logoId) return { company, role, previous: undefined as string | null | undefined };
      const ids = [...new Set([company.logoId, logoId].filter((value): value is string => !!value))].sort();
      const files = ids.length ? await tx.select().from(companyLogoFiles)
        .where(and(eq(companyLogoFiles.companyId, ctx.companyId), inArray(companyLogoFiles.id, ids))).orderBy(companyLogoFiles.id).for('update') : [];
      if (company.logoId) {
        const current = files.find(f => f.id === company.logoId);
        if (!current || current.status !== 'ACTIVE' || current.objectDeletedAt) throw new ConflictException('Foto atual inconsistente. Recarregue a empresa.');
      }
      if (logoId) {
        const next = files.find(f => f.id === logoId && f.createdByUserId === ctx.userId);
        if (!next) throw new NotFoundException('Foto não encontrada');
        if (next.status !== 'READY') throw new ConflictException('A foto ainda não está pronta');
        if (!next.unattachedExpiresAt || next.unattachedExpiresAt <= new Date()) throw new GoneException(EXPIRED_READY);
      }
      const now = new Date();
      // A anterior sai de ACTIVE antes da nova entrar, por causa do índice único parcial.
      if (company.logoId) await tx.update(companyLogoFiles).set({ status: 'DELETING', deletedAt: now, updatedAt: now }).where(eq(companyLogoFiles.id, company.logoId));
      if (logoId) await tx.update(companyLogoFiles).set({ status: 'ACTIVE', unattachedExpiresAt: null, updatedAt: now }).where(eq(companyLogoFiles.id, logoId));
      const [saved] = await tx.update(companies).set({ logoId, updatedAt: now }).where(eq(companies.id, ctx.companyId)).returning();
      return { company: saved, role, previous: company.logoId };
    });
    if (outcome.previous !== undefined) this.logger.log({ event: 'company_logo_changed', ...ctx, previousLogoId: outcome.previous, logoId });
    return { ...outcome.company, role: outcome.role };
  }

  async access(userId: string) {
    const rows = await this.database.db.select({ companyId: companies.id, logoId: companyLogoFiles.id, bucket: companyLogoFiles.bucket, key: companyLogoFiles.thumbObjectKey })
      .from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .innerJoin(companyLogoFiles, and(eq(companyLogoFiles.id, companies.logoId), eq(companyLogoFiles.companyId, companies.id)))
      .where(and(eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id),
        eq(companyLogoFiles.status, 'ACTIVE'), isNull(companyLogoFiles.objectDeletedAt)));
    if (!rows.length) return { items: [] };
    try {
      const expiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString();
      // A assinatura é local (sem chamada ao R2); só a miniatura é servida nesta entrega.
      // O cliente agenda a renovação por expiresInSeconds (relógio dele); expiresAt é só informativo (Spec D13).
      const items = await Promise.all(rows.map(async row => ({ companyId: row.companyId, logoId: row.logoId, expiresAt, expiresInSeconds: ACCESS_TTL_SECONDS,
        url: await this.storage.signDownload(row.bucket, row.key, 'logo-128.webp', 'image/webp', false, ACCESS_TTL_SECONDS) })));
      return { items };
    } catch (error) { this.unavailable('company_logo_access', { userId }, error); }
  }

  async cleanup(limit = 30) {
    if (!this.storage.enabled) return { cleaned: 0, failed: 0 };
    const due = sql`(
      (${companyLogoFiles.stagingCleanedAt} is null and ${companyLogoFiles.uploadExpiresAt} < now() - interval '60 seconds') or
      (${companyLogoFiles.objectDeletedAt} is null and (
        ${companyLogoFiles.status} in ('REJECTED','EXPIRED','DELETING') or
        (${companyLogoFiles.status} = 'PENDING' and ${companyLogoFiles.uploadExpiresAt} < now()) or
        (${companyLogoFiles.status} = 'READY' and ${companyLogoFiles.unattachedExpiresAt} < now())
      ))
    )`;
    const candidates = await this.database.db.select({ id: companyLogoFiles.id }).from(companyLogoFiles).where(due).orderBy(companyLogoFiles.updatedAt).limit(limit);
    let cleaned = 0, failed = 0;
    for (const candidate of candidates) {
      try {
        const changed = await this.database.db.transaction(async tx => {
          const [row] = await tx.select().from(companyLogoFiles).where(and(eq(companyLogoFiles.id, candidate.id), due)).for('update', { skipLocked: true }).limit(1);
          if (!row) return false;
          // Não trava a empresa: evita inverter a ordem de travas do PUT (empresa → arquivo).
          const [referenced] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, row.companyId), eq(companies.logoId, row.id))).limit(1);
          const time = new Date(), patch: Partial<typeof companyLogoFiles.$inferInsert> = { updatedAt: time };
          // O PUT temporário pode ser reutilizado até vencer; só apaga depois do prazo + 1 minuto.
          if (!row.stagingCleanedAt && row.uploadExpiresAt.getTime() + 60_000 < time.getTime()) { await this.storage.remove(row.bucket, row.stagingKey); patch.stagingCleanedAt = time; }
          const expired = (row.status === 'PENDING' && row.uploadExpiresAt <= time) || (row.status === 'READY' && !!row.unattachedExpiresAt && row.unattachedExpiresAt <= time);
          if (!referenced && !row.objectDeletedAt && (expired || ['REJECTED', 'EXPIRED', 'DELETING'].includes(row.status))) {
            await this.storage.remove(row.bucket, row.thumbObjectKey);
            await this.storage.remove(row.bucket, row.objectKey);
            patch.objectDeletedAt = time;
            if (row.status === 'DELETING') patch.status = 'DELETED';
            else if (expired) patch.status = 'EXPIRED';
          }
          if (Object.keys(patch).length === 1) return false;
          await tx.update(companyLogoFiles).set(patch).where(eq(companyLogoFiles.id, row.id));
          return true;
        });
        if (changed) cleaned++;
      } catch (error) {
        failed++;
        this.logger.warn({ event: 'company_logo_cleanup_failed', fileId: candidate.id, errorType: error instanceof Error ? error.name : 'Unknown' });
      }
    }
    return { cleaned, failed };
  }

  private unavailable(event: string, ids: Partial<LogoContext & { fileId: string }>, error: unknown): never {
    if (error instanceof ServiceUnavailableException) throw error;
    this.logger.warn({ event, ...ids, errorType: error instanceof Error ? error.name : 'Unknown' });
    throw new ServiceUnavailableException('Armazenamento temporariamente indisponível. Tente novamente em instantes.');
  }
}
