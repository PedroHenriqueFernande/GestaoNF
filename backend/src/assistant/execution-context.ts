// backend/src/assistant/execution-context.ts
import { companies, companyUsers } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from './db-types.js';

export type CompanyRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'COLLABORATOR';

/** Autoridade de uma execução do Nero. Sempre montada pelo sistema; a IA nunca preenche estes campos. */
export type ExecutionContext = {
  channel: 'WHATSAPP';
  userId: string;
  companyId: string;
  companyLinkId: string;
  companyName: string;
  companyCount: number;
  linkId: string;
  conversationId: string;
  runId: string;
  role: CompanyRole;
  timezone: string;
  today: string;
};

export function localDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function loadExecutionContext(db: DbExecutor, base: Omit<ExecutionContext, 'role' | 'timezone' | 'today'>): Promise<ExecutionContext | null> {
  const [row] = await db.select({ role: companyUsers.role, timezone: companies.timezone }).from(companyUsers)
    .innerJoin(companies, eq(companies.id, companyUsers.companyId))
    .where(and(eq(companyUsers.companyId, base.companyId), eq(companyUsers.userId, base.userId), eq(companyUsers.status, 'ACTIVE'))).limit(1);
  if (!row) return null;
  return { ...base, role: row.role as CompanyRole, timezone: row.timezone, today: localDate(row.timezone) };
}
