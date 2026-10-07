import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { companies, companyUsers } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { DatabaseService } from '../database/database.module.js';
import { allowedWebOrigins } from '../common/origins.js';

export type RequestContext = FastifyRequest & { userId?: string; companyId?: string };

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const token = bearer ?? request.cookies?.access_token;
    if (!token) throw new UnauthorizedException('Autenticação necessária');
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (!origin || !allowedWebOrigins().includes(origin)) throw new ForbiddenException('Origem da requisição inválida');
    }
    request.userId = await this.auth.verifyAccess(token);
    return true;
  }
}

@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const companyId = request.headers['x-company-id'];
    if (!companyId || Array.isArray(companyId) || !z.uuid().safeParse(companyId).success) throw new ForbiddenException('Informe X-Company-Id válido');
    const [membership] = await this.database.db.select({ companyId: companyUsers.companyId }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, request.userId!), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'))).limit(1);
    if (!membership) throw new ForbiddenException('Sem acesso à empresa');
    request.companyId = membership.companyId;
    return true;
  }
}
