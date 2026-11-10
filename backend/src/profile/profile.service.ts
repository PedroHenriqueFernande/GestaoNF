import { BadRequestException, ConflictException, GoneException, HttpException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { userAvatarFiles, users } from '@gestaonf/database/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.module.js';
import { InvalidStoredContent, ObjectNotUploaded, R2StorageService } from '../files/r2-storage.service.js';
import { normalizeAvatar } from './avatar-content.js';
import type { BeginAvatarUpload, PatchProfile } from './profile.schemas.js';

type Avatar = typeof userAvatarFiles.$inferSelect;
const publicUser = (u: typeof users.$inferSelect) => ({ id: u.id, name: u.name, email: u.email, avatarId: u.avatarId, profileVersion: u.profileVersion });
const publicFile = (f: Avatar) => ({ id: f.id, status: f.status, mimeType: f.mimeType, width: f.width, height: f.height, sizeBytes: f.sizeBytes });

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(R2StorageService) private readonly storage: R2StorageService) {}

  async begin(userId: string, input: BeginAvatarUpload, key: string) {
    this.storage.requireClient();
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const row = await this.database.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`avatar:reserve:${userId}`}, 0))`);
      const [user] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.status, 'ACTIVE'))).limit(1);
      if (!user) throw new UnauthorizedException();
      const [existing] = await tx.select().from(userAvatarFiles).where(and(eq(userAvatarFiles.userId, userId), eq(userAvatarFiles.requestKey, key))).limit(1);
      if (existing) { if (existing.requestHash !== hash) throw new ConflictException('Chave de upload já utilizada com outro arquivo'); return existing; }
      const [limits] = await tx.select({ pending: sql<number>`count(*) filter (where ${userAvatarFiles.id} <> coalesce(${user.avatarId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid) and (${userAvatarFiles.stagingCleanedAt} is null or ${userAvatarFiles.objectDeletedAt} is null))`, recent: sql<number>`count(*) filter (where ${userAvatarFiles.createdAt} > now() - interval '1 minute')` }).from(userAvatarFiles).where(eq(userAvatarFiles.userId, userId));
      if (Number(limits.pending) >= 3 || Number(limits.recent) >= 5) throw new HttpException('Limite de uploads atingido. Aguarde a limpeza ou um minuto.', 429);
      const id = randomUUID(), now = new Date();
      const [created] = await tx.insert(userAvatarFiles).values({ id, userId, requestKey: key, requestHash: hash, inputMimeType: input.mimeType, expectedBytes: input.sizeBytes,
        bucket: this.storage.config!.bucket, stagingKey: `uploads/avatars/${userId}/${id}/${randomUUID()}`, objectKey: `avatars/${userId}/${id}/avatar.webp`, status: 'PENDING', uploadExpiresAt: new Date(now.getTime() + 600_000) }).returning();
      return created;
    });
    if (row.status === 'READY' && row.unattachedExpiresAt && row.unattachedExpiresAt <= new Date()) throw new GoneException('Foto pronta expirada');
    if (row.status === 'READY' || row.status === 'ACTIVE') return { file: { id: row.id, status: row.status }, upload: null };
    if (row.status !== 'PENDING' || row.uploadExpiresAt <= new Date()) throw new GoneException('Upload expirado ou encerrado');
    try {
      const seconds = Math.max(1, Math.floor((row.uploadExpiresAt.getTime() - Date.now()) / 1000));
      const url = await this.storage.signUpload(row.bucket, row.stagingKey, row.inputMimeType, row.expectedBytes, seconds);
      return { file: { id: row.id, status: row.status }, upload: { url, method: 'PUT' as const, headers: { 'Content-Type': row.inputMimeType, 'Cache-Control': 'private, no-store' }, expiresAt: row.uploadExpiresAt.toISOString() } };
    } catch (error) { this.unavailable('avatar_sign_upload', error); }
  }

  async complete(userId: string, id: string) {
    this.storage.requireClient();
    let rejection: string | null = null;
    const result = await this.database.db.transaction(async tx => {
      const [row] = await tx.select().from(userAvatarFiles).where(and(eq(userAvatarFiles.id, id), eq(userAvatarFiles.userId, userId))).for('update').limit(1);
      if (!row) throw new NotFoundException('Foto não encontrada');
      if (row.status === 'READY' && row.unattachedExpiresAt && row.unattachedExpiresAt <= new Date()) throw new GoneException('Foto pronta expirada');
      if (row.status === 'READY' || row.status === 'ACTIVE') return { file: publicFile(row), expiresAt: row.unattachedExpiresAt?.toISOString() ?? null };
      if (row.status !== 'PENDING' || row.uploadExpiresAt <= new Date()) throw new GoneException('Upload expirado ou encerrado');
      try {
        const head = await this.storage.head(row.bucket, row.stagingKey);
        if (head.sizeBytes !== row.expectedBytes || head.mimeType !== row.inputMimeType || !head.etag) throw new InvalidStoredContent('Tipo ou tamanho diferente do declarado');
        const read = await this.storage.read(row.bucket, row.stagingKey, head.etag, row.expectedBytes);
        if (read.body.length !== row.expectedBytes || read.mimeType !== row.inputMimeType) throw new InvalidStoredContent('Upload incompleto ou alterado');
        const normalized = await normalizeAvatar(read.body, row.inputMimeType);
        await this.storage.put(row.bucket, row.objectKey, normalized.body, 'image/webp', 'avatar.webp');
        const now = new Date();
        const [saved] = await tx.update(userAvatarFiles).set({ status: 'READY', mimeType: 'image/webp', sizeBytes: normalized.body.length, width: normalized.width, height: normalized.height,
          sha256: createHash('sha256').update(normalized.body).digest('hex'), readyAt: now, unattachedExpiresAt: new Date(now.getTime() + 86_400_000), updatedAt: now }).where(eq(userAvatarFiles.id, id)).returning();
        return { file: publicFile(saved), expiresAt: saved.unattachedExpiresAt!.toISOString() };
      } catch (error) {
        if (error instanceof ObjectNotUploaded) throw new ConflictException('O upload ainda não chegou');
        if (error instanceof InvalidStoredContent) {
          rejection = error.message;
          await tx.update(userAvatarFiles).set({ status: 'REJECTED', updatedAt: new Date() }).where(eq(userAvatarFiles.id, id));
          return null;
        }
        this.unavailable('avatar_complete', error);
      }
    });
    if (rejection) throw new BadRequestException(rejection);
    return result!;
  }

  async patch(userId: string, input: PatchProfile) {
    return this.database.db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update').limit(1);
      if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
      if (user.profileVersion !== input.expectedVersion) throw new ConflictException('Perfil alterado em outra sessão');
      const nextName = input.name ?? user.name, nextAvatar = input.avatarId === undefined ? user.avatarId : input.avatarId;
      if (nextName === user.name && nextAvatar === user.avatarId) return publicUser(user);
      const ids = [...new Set([user.avatarId, nextAvatar].filter((id): id is string => !!id))].sort();
      const files = ids.length ? await tx.select().from(userAvatarFiles).where(inArray(userAvatarFiles.id, ids)).orderBy(userAvatarFiles.id).for('update') : [];
      if (user.avatarId) {
        const current = files.find(f => f.id === user.avatarId && f.userId === userId);
        if (!current || current.status !== 'ACTIVE' || current.objectDeletedAt) throw new ConflictException('Foto atual inconsistente. Recarregue o perfil.');
      }
      if (nextAvatar && nextAvatar !== user.avatarId) {
        const next = files.find(f => f.id === nextAvatar && f.userId === userId);
        if (!next) throw new NotFoundException('Foto não encontrada');
        if (next.status !== 'READY') throw new ConflictException('Foto não está pronta');
        if (!next.unattachedExpiresAt || next.unattachedExpiresAt <= new Date()) throw new GoneException('Foto pronta expirada');
      }
      const now = new Date();
      if (user.avatarId && user.avatarId !== nextAvatar) await tx.update(userAvatarFiles).set({ status: 'DELETING', deletedAt: now, updatedAt: now }).where(and(eq(userAvatarFiles.id, user.avatarId), eq(userAvatarFiles.userId, userId)));
      if (nextAvatar && nextAvatar !== user.avatarId) await tx.update(userAvatarFiles).set({ status: 'ACTIVE', unattachedExpiresAt: null, updatedAt: now }).where(eq(userAvatarFiles.id, nextAvatar));
      const [saved] = await tx.update(users).set({ name: nextName, avatarId: nextAvatar, profileVersion: user.profileVersion + 1, updatedAt: now }).where(eq(users.id, userId)).returning();
      return publicUser(saved);
    });
  }

  async access(userId: string) {
    const [row] = await this.database.db.select({ user: users, avatar: userAvatarFiles }).from(users).innerJoin(userAvatarFiles, and(eq(users.avatarId, userAvatarFiles.id), eq(users.id, userAvatarFiles.userId)))
      .where(and(eq(users.id, userId), eq(users.status, 'ACTIVE'), eq(userAvatarFiles.status, 'ACTIVE'), isNull(userAvatarFiles.objectDeletedAt))).limit(1);
    if (!row) throw new NotFoundException('Sem foto atual');
    try {
      const url = await this.storage.signDownload(row.avatar.bucket, row.avatar.objectKey, 'avatar.webp', 'image/webp', false, 120);
      return { avatarId: row.avatar.id, url, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    } catch (error) { this.unavailable('avatar_access', error); }
  }

  async cleanup(limit = 30) {
    if (!this.storage.enabled) return { cleaned: 0, failed: 0 };
    const now = new Date();
    const due = sql`(
      (${userAvatarFiles.stagingCleanedAt} is null and ${userAvatarFiles.uploadExpiresAt} < now() - interval '60 seconds') or
      (${userAvatarFiles.objectDeletedAt} is null and (
        ${userAvatarFiles.status} in ('REJECTED','EXPIRED','DELETING') or
        (${userAvatarFiles.status} = 'PENDING' and ${userAvatarFiles.uploadExpiresAt} < now()) or
        (${userAvatarFiles.status} = 'READY' and ${userAvatarFiles.unattachedExpiresAt} < now())
      ))
    )`;
    const candidates = await this.database.db.select({ id: userAvatarFiles.id }).from(userAvatarFiles).where(due).orderBy(userAvatarFiles.updatedAt).limit(limit);
    let cleaned = 0, failed = 0;
    for (const candidate of candidates) {
      try {
        const changed = await this.database.db.transaction(async tx => {
          const [row] = await tx.select().from(userAvatarFiles).where(and(eq(userAvatarFiles.id, candidate.id), due)).for('update', { skipLocked: true }).limit(1);
          if (!row) return false;
          const [current] = await tx.select({ id: users.id }).from(users).where(and(eq(users.avatarId, row.id), eq(users.id, row.userId))).limit(1);
          const time = new Date(), patch: Partial<typeof userAvatarFiles.$inferInsert> = { updatedAt: time };
          if (!row.stagingCleanedAt && row.uploadExpiresAt.getTime() + 60_000 < time.getTime()) { await this.storage.remove(row.bucket, row.stagingKey); patch.stagingCleanedAt = time; }
          const expired = row.status === 'PENDING' && row.uploadExpiresAt <= time || row.status === 'READY' && !!row.unattachedExpiresAt && row.unattachedExpiresAt <= time;
          if (!current && (expired || ['REJECTED', 'EXPIRED', 'DELETING'].includes(row.status))) {
            if (!row.objectDeletedAt) { await this.storage.remove(row.bucket, row.objectKey); patch.objectDeletedAt = time; }
            if (row.status === 'DELETING') patch.status = 'DELETED';
            else if (expired) patch.status = 'EXPIRED';
          }
          if (Object.keys(patch).length > 1) await tx.update(userAvatarFiles).set(patch).where(eq(userAvatarFiles.id, row.id));
          return Object.keys(patch).length > 1;
        });
        if (changed) cleaned++;
      } catch (error) { failed++; this.logger.warn({ event: 'avatar_cleanup_failed', fileId: candidate.id, errorType: error instanceof Error ? error.name : 'Unknown' }); }
    }
    return { cleaned, failed };
  }
  private unavailable(event: string, error: unknown): never {
    if (error instanceof ServiceUnavailableException) throw error;
    this.logger.warn({ event, errorType: error instanceof Error ? error.name : 'Unknown' });
    throw new ServiceUnavailableException('Armazenamento temporariamente indisponível');
  }
}
