import { companyAvailable } from '../accounts/account-policy.js';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyUsers, users, crmContacts, crmOpportunities, crmLeadEntries, crmMeetings, services } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import type { CrmContext } from './crm.schemas.js';
import type { CrmDb } from './crm-normalization.js';
import { requirePermission, type Actor } from '../permissions/actor.js';
import { resolveActor } from '../permissions/permission-resolver.js';

export type CrmAccess = CrmContext & { actor: Actor; timezone: string };
@Injectable()
export class CrmPolicyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async access(ctx: CrmContext, db: CrmDb = this.database.db): Promise<CrmAccess> {
    const [row] = await db.select({ timezone: companies.timezone }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId)).innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, ctx.companyId), eq(companyUsers.userId, ctx.userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id), eq(users.status, 'ACTIVE'))).limit(1);
    if (!row) throw new ForbiddenException('Sem acesso ativo à empresa');
    const actor = await resolveActor(db, ctx.userId, ctx.companyId);
    if (!actor) throw new ForbiddenException('Sem acesso ativo à empresa');
    return { ...ctx, actor, timezone: row.timezone };
  }
  contactScope(a: CrmAccess) { return eq(crmContacts.companyId, a.companyId); }
  opportunityScope(a: CrmAccess) { return eq(crmOpportunities.companyId, a.companyId); }
  meetingScope(a: CrmAccess) { return eq(crmMeetings.companyId, a.companyId); }
  entryScope(a: CrmAccess) { return eq(crmLeadEntries.companyId, a.companyId); }
  async contact(a: CrmAccess, id: string, db: CrmDb = this.database.db, lock = false) {
    const query = db.select().from(crmContacts).where(and(this.contactScope(a), eq(crmContacts.id, id))).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Lead não encontrado');
    return row;
  }
  async opportunity(a: CrmAccess, id: string, db: CrmDb = this.database.db, lock = false) {
    const query = db.select().from(crmOpportunities).where(and(this.opportunityScope(a), eq(crmOpportunities.id, id))).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Negociação não encontrada');
    return row;
  }
  async meeting(a: CrmAccess, id: string, db: CrmDb = this.database.db, lock = false) {
    const query = db.select().from(crmMeetings).where(and(this.meetingScope(a), eq(crmMeetings.id, id))).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Reunião não encontrada');
    return row;
  }
  /**
   * Regra única de responsável (D18). Criar: responsável diferente de si (ou nenhum) exige `crm.assign`.
   * Editar (`current` informado): só exige `crm.assign` se o responsável mudar.
   */
  async assignee(a: CrmAccess, id: string | null, db: CrmDb, current?: { assignedUserId: string | null }) {
    const changes = current ? id !== current.assignedUserId : id !== a.userId;
    if (changes) requirePermission(a.actor, 'crm.assign', 'crm:assignee');
    if (id === null) return;
    const [member] = await db.select({ id: companyUsers.userId }).from(companyUsers).innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, a.companyId), eq(companyUsers.userId, id), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).for('share').limit(1);
    if (!member) throw new BadRequestException('Responsável inválido ou inativo');
  }
  async service(a: CrmAccess, id: string | null | undefined, db: CrmDb) {
    if (!id) return null;
    const [row] = await db.select().from(services).where(and(eq(services.companyId, a.companyId), eq(services.id, id), eq(services.status, 'ACTIVE'))).for('share').limit(1);
    if (!row) throw new BadRequestException('Serviço inválido ou inativo');
    return row;
  }
  activeContact(c: typeof crmContacts.$inferSelect) {
    if (c.archivedAt) throw new BadRequestException('Restaure o lead antes desta operação');
  }
}

