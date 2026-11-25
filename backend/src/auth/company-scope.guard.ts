import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import { assertPolicy, denialOf, PermissionDeniedException } from '../permissions/actor.js';
import { policyOf } from '../permissions/permission.decorators.js';
import { resolveMemberships } from '../permissions/permission-resolver.js';
import { routeEntry, type RequestContext } from './access.guard.js';

export const MAX_SCOPE_COMPANIES = 50;
const companyIdsSchema = z.string().transform(value => value.toLowerCase().split(','))
  .pipe(z.array(z.uuid()).min(1).max(MAX_SCOPE_COMPANIES, `Selecione até ${MAX_SCOPE_COMPANIES} empresas`))
  .refine(ids => new Set(ids).size === ids.length, 'Empresas repetidas');
/** Escopo de leitura consolidada: exatamente um entre `companies=all` e `companyIds=a,b`. */
export const companyScopeSchema = z.union([z.strictObject({ companies: z.literal('all') }), z.strictObject({ companyIds: companyIdsSchema })]);
/** Campos de escopo aceitos pelos schemas estritos. A autorização ocorre no guard. */
export const scopeQueryFields = { companies: z.string().optional(), companyIds: z.string().optional() };
const scopeArea = (entry: string) => entry.includes('/crm/overview/') ? 'crm' : 'sales';

/**
 * Resolve e autoriza no servidor, a cada requisição, as empresas de uma leitura consolidada.
 * A permissão declarada na rota é avaliada empresa a empresa (Spec 7.1):
 * - em `all`, ficam só as permitidas;
 * - em `companyIds`, qualquer empresa sem vínculo ou sem permissão gera 403.
 * Somente para rotas GET; escritas continuam com CompanyGuard.
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
    const entry = routeEntry(request);
    const area = scopeArea(entry);
    const policy = policyOf(context.getHandler());
    if (!policy || policy.kind === 'owner') {
      this.logger.error({ event: 'permission_policy_missing', entry });
      throw new ForbiddenException('Rota sem política de permissão');
    }
    const memberships = await resolveMemberships(this.database.db, request.userId!, requested ?? 'all');
    const logDenied = (authorized: number) => this.logger.warn({ event: `${area}_overview_scope_denied`, userId: request.userId,
      mode: requested ? 'ids' : 'all', requested: requested?.length ?? null, authorized });
    if (requested ? memberships.length !== requested.length : memberships.length === 0) {
      logDenied(memberships.length);
      if (area === 'crm' && !requested && 'keys' in policy) throw new PermissionDeniedException(policy.keys[0]);
      throw new ForbiddenException('Sem acesso a uma ou mais empresas selecionadas');
    }
    const allowed = memberships.filter(m => denialOf(m.actor, policy) === null);
    const denied = memberships.find(m => denialOf(m.actor, policy) !== null);
    if (denied && (requested || allowed.length === 0)) {
      if (area === 'crm') logDenied(allowed.length);
      assertPolicy(denied.actor, policy, entry);
    }
    if (allowed.length > MAX_SCOPE_COMPANIES) {
      this.logger.warn({ event: `${area}_overview_scope_too_large`, userId: request.userId, authorized: allowed.length });
      throw new BadRequestException(`Selecione até ${MAX_SCOPE_COMPANIES} empresas`);
    }
    request.companyActors = allowed.map(m => m.actor);
    request.companyIds = request.companyActors.map(actor => actor.companyId);
    return true;
  }
}
