import { ForbiddenException } from '@nestjs/common';
import { companyUsers } from '@gestaonf/database/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseService } from '../database/database.module.js';

type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type Db = DatabaseService['db'] | Tx;

/** Único lugar da regra "quem altera os dados da empresa" (cadastro e foto). */
export const COMPANY_MANAGER_ROLES = ['OWNER', 'ADMIN'] as const;
export const isCompanyManagerRole = (role: string) => (COMPANY_MANAGER_ROLES as readonly string[]).includes(role);

export function companyManagerQuery(db: Db, companyId: string, userId: string) {
  return db.select({ role: companyUsers.role }).from(companyUsers)
    .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), inArray(companyUsers.role, [...COMPANY_MANAGER_ROLES])));
}

export async function assertCompanyManager(db: Db, companyId: string, userId: string) {
  const [row] = await companyManagerQuery(db, companyId, userId).limit(1);
  if (!row) throw new ForbiddenException('Sem permissão para alterar a empresa');
  return row;
}
