// backend/src/assistant/execution-context.ts
import { companies } from '@gestaonf/database/schema';
import { eq } from 'drizzle-orm';
import type { Actor } from '../permissions/actor.js';
import { resolveActor } from '../permissions/permission-resolver.js';
import type { DbExecutor } from './db-types.js';

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
  actor: Actor;
  timezone: string;
  today: string;
};

export function localDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function loadExecutionContext(db: DbExecutor, base: Omit<ExecutionContext, 'actor' | 'timezone' | 'today'>): Promise<ExecutionContext | null> {
  const actor = await resolveActor(db, base.userId, base.companyId);
  if (!actor) return null;
  const [company] = await db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, base.companyId)).limit(1);
  if (!company) return null;
  return { ...base, actor, timezone: company.timezone, today: localDate(company.timezone) };
}
