import { accountMembers } from '@gestaonf/database/schema';
import { sql } from 'drizzle-orm';
import type { DatabaseService } from '../src/database/database.module.js';
import { ALL_PERMISSIONS, PERMISSION_KEYS, type PermissionKey, type RoleLabel } from '@gestaonf/permissions';

/** Conjunto Colaborador (34), congelado como na migração 0041. Não é modelo de interface. */
export const LEGACY_COLLABORATOR: readonly PermissionKey[] = [
  'sales.access', 'sales.create', 'sales.edit', 'sales.delete', 'sales.change_price', 'sales.attachments_view',
  'finance.access', 'finance.receive', 'finance.reverse', 'finance.edit_dates',
  'crm.access', 'crm.create', 'crm.edit',
  'agenda.access', 'agenda.manage',
  'proposals.access', 'proposals.manage', 'proposals.change_price', 'proposals.convert',
  'reports.access', 'reports.export',
  'customers.access', 'customers.create', 'customers.edit', 'customers.deactivate', 'customers.export',
  'services.access', 'services.create', 'services.edit', 'services.edit_price', 'services.deactivate',
  'company.access', 'nero.use', 'support.assistant',
];
const MANAGER_EXTRA: readonly PermissionKey[] = ['crm.archive', 'crm.assign', 'agenda.settings', 'proposals.settings'];
/** Conjunto Gerente (38) = Colaborador + archive, assign e configurações. */
export const LEGACY_MANAGER: readonly PermissionKey[] = PERMISSION_KEYS.filter(key => LEGACY_COLLABORATOR.includes(key) || MANAGER_EXTRA.includes(key));

/** Grava (ou sobrescreve) a linha do membro. Não valida dependências: o teste escolhe o conjunto. */
export async function grantMember(db: Pick<DatabaseService['db'], 'insert'>, accountId: string, userId: string, permissions: readonly PermissionKey[], roleLabel: RoleLabel = 'COLLABORATOR') {
  const values = { roleLabel, permissions: [...permissions] };
  await db.insert(accountMembers).values({ accountId, userId, ...values })
    .onConflictDoUpdate({ target: [accountMembers.accountId, accountMembers.userId], set: { ...values, version: sql`${accountMembers.version} + 1`, updatedAt: new Date() } });
}

const keysArray = (keys: readonly PermissionKey[]) => sql.raw(`ARRAY[${keys.map(key => `'${key}'`).join(',')}]::text[]`);

/** Espelho, para seeds de teste, do backfill da migração 0041 (Spec 6.1). Idempotente. */
export async function grantLegacyMembers(db: Pick<DatabaseService['db'], 'execute'>) {
  await db.execute(sql`INSERT INTO account_members (account_id, user_id, role_label, permissions)
    SELECT c.account_id, cu.user_id,
      CASE WHEN bool_or(cu.role = 'OWNER') THEN 'OWNER' WHEN bool_or(cu.role IN ('ADMIN', 'MANAGER')) THEN 'MANAGER' ELSE 'COLLABORATOR' END,
      CASE WHEN bool_or(cu.role IN ('OWNER', 'ADMIN')) THEN ${keysArray(ALL_PERMISSIONS)}
           WHEN bool_or(cu.role = 'MANAGER') THEN ${keysArray(LEGACY_MANAGER)}
           ELSE ${keysArray(LEGACY_COLLABORATOR)} END
    FROM company_users cu JOIN companies c ON c.id = cu.company_id JOIN accounts a ON a.id = c.account_id
    WHERE cu.user_id <> a.owner_user_id
    GROUP BY c.account_id, cu.user_id
    ON CONFLICT (account_id, user_id) DO NOTHING`);
}
