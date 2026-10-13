import type { FastifyReply } from 'fastify';
import type { ClientType } from './auth.schemas.js';
export function authResponse<T extends { accessToken: string; refreshToken: string; expiresIn: number }>(result: T, client: ClientType, reply: FastifyReply) {
  if (client === 'mobile') return result;
  const secure = process.env.NODE_ENV === 'production';
  reply.setCookie('access_token', result.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: result.expiresIn });
  reply.setCookie('refresh_token', result.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/auth', maxAge: 30 * 86400 });
  const { accessToken: _access, refreshToken: _refresh, ...publicResult } = result;
  return publicResult;
}
