import { ForbiddenException, Logger } from '@nestjs/common';
import { accountMembers, accounts, companies, companyUsers } from '@gestaonf/database/schema';
import { ALL_PERMISSIONS, ROLE_LABELS, isPermissionKey, sortByCatalog, type PermissionKey, type RoleLabel } from '@gestaonf/permissions';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { companyAvailable, type AccountDb } from '../accounts/account-policy.js';
import { assertPolicy, type Actor, type PermissionPolicy } from './actor.js';

/** O rótulo fica fora do Actor: só serve para apresentação (/companies, lista de usuários). */
export type ResolvedMembership = Readonly<{ actor: Actor; roleLabel: RoleLabel }>;
const logger = new Logger('PermissionResolver');

/**
 * Única consulta de autorização (Spec 7.1): vínculo ativo, empresa e contratação disponíveis,
 * titularidade e permissões efetivas. Função de módulo, no padrão de account-policy.ts,
 * usada por guards, Nero, suporte e workers.
 */
export async function resolveMemberships(db: AccountDb, userId: string, scope: readonly string[] | 'all'): Promise<ResolvedMembership[]> {
  if (scope !== 'all' && scope.length === 0) return [];
  const rows = await db.select({
    companyId: companyUsers.companyId, accountId: companies.accountId, ownerUserId: accounts.ownerUserId,
    memberUserId: accountMembers.userId, roleLabel: accountMembers.roleLabel, permissions: accountMembers.permissions,
  }).from(companyUsers)
    .innerJoin(companies, eq(companies.id, companyUsers.companyId))
    .innerJoin(accounts, eq(accounts.id, companies.accountId))
    .leftJoin(accountMembers, and(eq(accountMembers.accountId, companies.accountId), eq(accountMembers.userId, companyUsers.userId)))
    .where(and(eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id),
      ...(scope === 'all' ? [] : [inArray(companyUsers.companyId, [...scope])])))
    .orderBy(asc(companyUsers.companyId));
  return rows.map(row => {
    const accountOwner = row.ownerUserId === userId;
    if (!accountOwner && row.memberUserId === null) logger.warn({ event: 'permission_row_missing', userId, companyId: row.companyId });
    const permissions = accountOwner ? ALL_PERMISSIONS : (row.permissions ?? []).filter(isPermissionKey);
    const roleLabel: RoleLabel = accountOwner ? 'OWNER' : ROLE_LABELS.find(label => label === row.roleLabel) ?? 'COLLABORATOR';
    return { roleLabel, actor: { userId, companyId: row.companyId, accountId: row.accountId, accountOwner, permissions: new Set(permissions) } };
  });
}

export async function resolveActor(db: AccountDb, userId: string, companyId: string): Promise<Actor | null> {
  const [membership] = await resolveMemberships(db, userId, [companyId]);
  return membership?.actor ?? null;
}

/** Forma pública das permissões efetivas (Spec 8.1). `role` é o campo legado, removido na contração (Spec 6.4). */
export function presentMembership(membership: ResolvedMembership) {
  return {
    roleLabel: membership.roleLabel,
    accountOwner: membership.actor.accountOwner,
    permissions: sortByCatalog(membership.actor.permissions),
    role: membership.roleLabel,
  };
}

/**
 * Revalida, dentro da transação de escrita (ou do serviço), o vínculo ativo e uma política (uma ou várias chaves).
 * Fecha a janela entre o guard e a escrita para operações com trava.
 */
export async function requireMembershipPolicy(db: AccountDb, userId: string, companyId: string, policy: PermissionPolicy, entry: string): Promise<ResolvedMembership> {
  const [membership] = await resolveMemberships(db, userId, [companyId]);
  if (!membership) throw new ForbiddenException('Sem acesso à empresa');
  assertPolicy(membership.actor, policy, entry);
  return membership;
}

export function requireMembershipPermission(db: AccountDb, userId: string, companyId: string, key: PermissionKey, entry: string): Promise<ResolvedMembership> {
  return requireMembershipPolicy(db, userId, companyId, { kind: 'all', keys: [key] }, entry);
}
