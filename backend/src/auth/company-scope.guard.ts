import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { companies, companyUsers } from '@gestaonf/database/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { companyAvailable } from '../accounts/account-policy.js';
import { parseInput } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import type { RequestContext } from './access.guard.js';

export const MAX_SCOPE_COMPANIES = 50;
const companyIdsSchema = z.string().transform(value => value.split(','))
  .pipe(z.array(z.uuid()).min(1).max(MAX_SCOPE_COMPANIES, `Selecione até ${MAX_SCOPE_COMPANIES} empresas`))
  .refine(ids => new Set(ids).size === ids.length, 'Empresas repetidas');
/** Escopo de leitura consolidada: exatamente um entre `companies=all` e `companyIds=a,b`. */
export const companyScopeSchema = z.union([z.strictObject({ companies: z.literal('all') }), z.strictObject({ companyIds: companyIdsSchema })]);

/**
 * Resolve e autoriza no servidor, a cada requisição, as empresas de uma leitura consolidada.
 * Falha fechada: qualquer empresa pedida sem vínculo ativo e contratação disponível gera 403.
 * Somente para rotas GET; escritas continuam com CompanyGuard (uma empresa por requisição).
 */
@Injectable()
export class CompanyScopeGuard implements CanActivate {
  private readonly logger = new Logger(CompanyScopeGuard.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const query = (request.query ?? {}) as Record<string, unknown>;
    const scope = parseInput(companyScopeSchema, Object.fromEntries(['companies', 'companyIds'].filter(key => key in query).map(key => [key, query[key]])));
    const requested = 'companyIds' in scope ? scope.companyIds : null;
    const rows = await this.database.db.select({ companyId: companyUsers.companyId }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .where(and(eq(companyUsers.userId, request.userId!), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id),
        ...(requested ? [inArray(companyUsers.companyId, requested)] : [])));
    const ids = rows.map(row => row.companyId).sort();
    if (requested ? ids.length !== requested.length : ids.length === 0) {
      this.logger.warn({ event: 'sales_overview_scope_denied', userId: request.userId, mode: requested ? 'ids' : 'all', requested: requested?.length ?? null, authorized: ids.length });
      throw new ForbiddenException('Sem acesso a uma ou mais empresas selecionadas');
    }
    if (ids.length > MAX_SCOPE_COMPANIES) {
      this.logger.warn({ event: 'sales_overview_scope_too_large', userId: request.userId, authorized: ids.length });
      throw new BadRequestException(`Selecione até ${MAX_SCOPE_COMPANIES} empresas`);
    }
    request.companyIds = ids;
    return true;
  }
}
