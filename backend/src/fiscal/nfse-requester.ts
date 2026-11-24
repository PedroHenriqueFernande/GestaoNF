import type { PermissionKey } from '@gestaonf/permissions';
import type { AccountDb } from '../accounts/account-policy.js';
import { can } from '../permissions/actor.js';
import { resolveMemberships } from '../permissions/permission-resolver.js';

/**
 * Workers de NFS-e revalidam quem pediu, no momento de executar (Spec 7.3).
 * Vínculo inativo, empresa ou contratação indisponível e permissão revogada falham com a mensagem atual.
 */
export async function assertRequesterAllowed(db: AccountDb, companyId: string, userId: string, key: PermissionKey): Promise<void> {
  const [requester] = await resolveMemberships(db, userId, [companyId]);
  if (!requester || !can(requester.actor, key)) throw new Error('O solicitante não possui mais permissão fiscal na empresa ativa.');
}
