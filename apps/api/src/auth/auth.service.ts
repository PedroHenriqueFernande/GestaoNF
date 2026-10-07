import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { authSessions, userCredentials, users } from '@gestaonf/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { DatabaseService } from '../database/database.module.js';
import { isUniqueViolation } from '../common/validate.js';
import type { z } from 'zod';
import type { loginSchema, registerSchema } from './auth.schemas.js';

const derivePassword = (password: string, salt: string, length: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
    if (error) reject(error);
    else resolve(key);
  });
});
const ACCESS_SECONDS = 15 * 60;
const REFRESH_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get jwtKey(): Uint8Array {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres');
    return new TextEncoder().encode(secret);
  }

  async register(input: z.infer<typeof registerSchema>) {
    const passwordHash = await this.hashPassword(input.password);
    try {
      const result = await this.database.db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ name: input.name, email: input.email }).returning();
        await tx.insert(userCredentials).values({ userId: user.id, passwordHash });
        return { user: { id: user.id, name: user.name, email: user.email } };
      });
      return { ...result, ...(await this.issueTokens(result.user.id)) };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('E-mail já cadastrado');
      throw error;
    }
  }

  async login(input: z.infer<typeof loginSchema>) {
    const rows = await this.database.db.select({ user: users, credential: userCredentials }).from(users)
      .innerJoin(userCredentials, eq(userCredentials.userId, users.id)).where(eq(users.email, input.email)).limit(1);
    const record = rows[0];
    if (!record || record.user.status !== 'ACTIVE' || !(await this.verifyPassword(input.password, record.credential.passwordHash))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return { user: { id: record.user.id, name: record.user.name, email: record.user.email }, ...(await this.issueTokens(record.user.id)) };
  }

  async me(userId: string) {
    const [user] = await this.database.db.select({ id: users.id, name: users.name, email: users.email }).from(users)
      .where(and(eq(users.id, userId), eq(users.status, 'ACTIVE'))).limit(1);
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.jwtKey, { issuer: 'gestaonf', audience: 'gestaonf-api' });
      if (typeof payload.sub !== 'string') throw new Error('invalid subject');
      await this.me(payload.sub);
      return payload.sub;
    } catch { throw new UnauthorizedException('Sessão inválida ou expirada'); }
  }

  async refresh(token: string) {
    const tokenHash = this.hashToken(token);
    return this.database.db.transaction(async (tx) => {
      const [session] = await tx.select().from(authSessions).where(and(eq(authSessions.tokenHash, tokenHash), isNull(authSessions.revokedAt))).for('update').limit(1);
      if (!session || session.expiresAt <= new Date()) throw new UnauthorizedException('Sessão inválida ou expirada');
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, session.userId), eq(users.status, 'ACTIVE'))).limit(1);
      if (!user) throw new UnauthorizedException('Sessão inválida ou expirada');
      await tx.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, session.id));
      return this.issueTokens(user.id, tx);
    });
  }

  async logout(token?: string) {
    if (token) await this.database.db.update(authSessions).set({ revokedAt: new Date() })
      .where(and(eq(authSessions.tokenHash, this.hashToken(token)), isNull(authSessions.revokedAt)));
  }

  private async issueTokens(userId: string, tx: Pick<DatabaseService['db'], 'insert'> = this.database.db) {
    const accessToken = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
      .setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime(`${ACCESS_SECONDS}s`).sign(this.jwtKey);
    const refreshToken = randomBytes(48).toString('base64url');
    await tx.insert(authSessions).values({ userId, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400_000) });
    return { accessToken, refreshToken, expiresIn: ACCESS_SECONDS };
  }

  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = await derivePassword(password, salt, 64);
    return `scrypt:${salt}:${hash.toString('hex')}`;
  }

  private async verifyPassword(password: string, stored: string) {
    const [algorithm, salt, expectedHex] = stored.split(':');
    if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, 'hex');
    if (expected.length !== 64) return false;
    const actual = await derivePassword(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  }
}
