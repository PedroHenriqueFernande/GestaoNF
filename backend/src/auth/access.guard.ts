import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { DatabaseService } from '../database/database.module.js';
import { allowedWebOrigins } from '../common/origins.js';
import { assertPolicy, type Actor } from '../permissions/actor.js';
import { policyOf } from '../permissions/permission.decorators.js';
import { resolveActor } from '../permissions/permission-resolver.js';

export type RequestContext = FastifyRequest & { userId?: string; companyId?: string; companyIds?: string[]; actor?: Actor };

/** Ponto de entrada registrado nos logs de autorização: método e padrão da rota, sem IDs. */
export const routeEntry = (request: FastifyRequest) => `${request.method} ${request.routeOptions?.url ?? '(rota desconhecida)'}`;

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
  private readonly logger = new Logger(CompanyGuard.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const companyId = request.headers['x-company-id'];
    if (!companyId || Array.isArray(companyId) || !z.uuid().safeParse(companyId).success) throw new ForbiddenException('Informe X-Company-Id válido');
    const actor = await resolveActor(this.database.db, request.userId!, companyId);
    if (!actor) throw new ForbiddenException('Sem acesso à empresa');
    const entry = routeEntry(request);
    const policy = policyOf(context.getHandler());
    if (!policy) {
      this.logger.error({ event: 'permission_policy_missing', entry });
      throw new ForbiddenException('Rota sem política de permissão');
    }
    assertPolicy(actor, policy, entry);
    request.companyId = actor.companyId;
    request.actor = actor;
    return true;
  }
}
