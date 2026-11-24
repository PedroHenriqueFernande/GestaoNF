import { ForbiddenException, Logger } from '@nestjs/common';
import { PERMISSION_DENIED_MESSAGE, type PermissionKey } from '@gestaonf/permissions';

/** Quem age, numa empresa. Sem rótulo: a classificação não autoriza nada (D2). */
export type Actor = Readonly<{ userId: string; companyId: string; accountId: string; accountOwner: boolean; permissions: ReadonlySet<PermissionKey> }>;

export type PermissionPolicy =
  | Readonly<{ kind: 'all'; keys: readonly PermissionKey[] }>
  | Readonly<{ kind: 'any'; keys: readonly PermissionKey[] }>
  | Readonly<{ kind: 'member' }>
  | Readonly<{ kind: 'owner' }>;

export type PolicyDenial =
  | Readonly<{ kind: 'permission'; permission: PermissionKey }>
  | Readonly<{ kind: 'owner' }>;

const logger = new Logger('Permissions');

/** 403 padronizado (D10). `permission` é a primeira chave que resolveria a negação. */
export class PermissionDeniedException extends ForbiddenException {
  constructor(readonly permission: PermissionKey) {
    super({ statusCode: 403, code: 'PERMISSION_DENIED', permission, message: PERMISSION_DENIED_MESSAGE });
  }
}

export class AccountOwnerRequiredException extends ForbiddenException {
  constructor() {
    super({ statusCode: 403, code: 'ACCOUNT_OWNER_REQUIRED', message: PERMISSION_DENIED_MESSAGE });
  }
}

export const can = (actor: Actor, key: PermissionKey) => actor.permissions.has(key);

export function denialOf(actor: Actor, policy: PermissionPolicy): PolicyDenial | null {
  switch (policy.kind) {
    case 'member': return null;
    case 'owner': return actor.accountOwner ? null : { kind: 'owner' };
    case 'all': {
      const missing = policy.keys.find(key => !can(actor, key));
      return missing ? { kind: 'permission', permission: missing } : null;
    }
    case 'any':
      return policy.keys.some(key => can(actor, key)) ? null : { kind: 'permission', permission: policy.keys[0] };
  }
}

/** Único ponto que nega e registra (Spec 7.4). `entry` = rota, ferramenta ou job. */
export function assertPolicy(actor: Actor, policy: PermissionPolicy, entry: string): void {
  const denial = denialOf(actor, policy);
  if (!denial) return;
  logger.warn({ event: 'permission_denied', userId: actor.userId, companyId: actor.companyId, permission: denial.kind === 'owner' ? 'ACCOUNT_OWNER' : denial.permission, entry });
  throw denial.kind === 'owner' ? new AccountOwnerRequiredException() : new PermissionDeniedException(denial.permission);
}

export function requirePermission(actor: Actor, key: PermissionKey, entry: string): void {
  assertPolicy(actor, { kind: 'all', keys: [key] }, entry);
}

/** Permissão declarada por ferramenta do Nero ou do suporte (Spec 9). Lista = qualquer uma delas. */
export type ToolPermission = PermissionKey | readonly [PermissionKey, ...PermissionKey[]] | 'ANY_MEMBER';

export const toolPolicy = (permission: ToolPermission): PermissionPolicy =>
  permission === 'ANY_MEMBER' ? { kind: 'member' } : typeof permission === 'string' ? { kind: 'all', keys: [permission] } : { kind: 'any', keys: permission };

export const toolAllowed = (actor: Actor, permission: ToolPermission) => denialOf(actor, toolPolicy(permission)) === null;

/** Texto único que o Nero e o assistente recebem quando falta permissão (D16): não cita permissões nem sugere contornos. */
export const NOT_ALLOWED_GUIDANCE = `${PERMISSION_DENIED_MESSAGE} Fale com o responsável pela conta.`;

export const isPermissionDenial = (error: unknown): boolean => error instanceof PermissionDeniedException || error instanceof AccountOwnerRequiredException;
