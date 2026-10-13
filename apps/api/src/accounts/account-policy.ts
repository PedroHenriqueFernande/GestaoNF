import { ForbiddenException } from '@nestjs/common';
import { sql, type SQLWrapper } from 'drizzle-orm';
import type { DatabaseService } from '../database/database.module.js';

export type AccountTx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export type AccountDb = DatabaseService['db'] | AccountTx;
export function companyAvailable(companyId: SQLWrapper) {
  return sql`exists (select 1 from companies ac join accounts aa on aa.id=ac.account_id join account_subscriptions ss on ss.account_id=aa.id where ac.id=${companyId} and ac.status='ACTIVE' and aa.status='ACTIVE' and ss.status='ACTIVE' and (ss.source='LEGACY_DEV' or ss.current_period_ends_at>now()))`;
}
export async function assertCompanyUsable(db: AccountDb, companyId: string) {
  const rows = await db.execute(sql`select 1 from companies ac join accounts aa on aa.id=ac.account_id join account_subscriptions ss on ss.account_id=aa.id where ac.id=${companyId} and ac.status='ACTIVE' and aa.status='ACTIVE' and ss.status='ACTIVE' and (ss.source='LEGACY_DEV' or ss.current_period_ends_at>now())`);
  if (!rows.length) throw new ForbiddenException('Contratação ou empresa indisponível');
}
