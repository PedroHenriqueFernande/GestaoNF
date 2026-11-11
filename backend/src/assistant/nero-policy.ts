// backend/src/assistant/nero-policy.ts
import type { ExecutionContext } from './execution-context.js';

/**
 * Regras que espelham o site. A autoridade final continua nos serviços de domínio;
 * estas regras apenas escondem do modelo o que o usuário não pode fazer.
 */
export const rules = {
  anyMember: (_ctx: ExecutionContext) => true,
  ownerOrAdmin: (ctx: ExecutionContext) => ctx.role === 'OWNER' || ctx.role === 'ADMIN',
  multiCompany: (ctx: ExecutionContext) => ctx.companyCount > 1,
};
