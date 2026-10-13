import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyUsers, users, crmContacts, crmOpportunities, crmLeadEntries, services } from '@gestaonf/database/schema';
import { and, eq, exists, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import type { CrmContext } from './crm.schemas.js';
import type { CrmDb } from './crm-normalization.js';

export type CrmAccess = CrmContext & { manager: boolean; timezone: string };
@Injectable()
export class CrmPolicyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async access(ctx: CrmContext, db: CrmDb = this.database.db): Promise<CrmAccess> {
    const [row] = await db.select({ role: companyUsers.role, timezone: companies.timezone }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId)).innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, ctx.companyId), eq(companyUsers.userId, ctx.userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).limit(1);
    if (!row) throw new ForbiddenException('Sem acesso ativo à empresa');
    return { ...ctx, manager: row.role !== 'COLLABORATOR', timezone: row.timezone };
  }
  contactScope(a: CrmAccess, db: CrmDb = this.database.db) {
    return and(eq(crmContacts.companyId, a.companyId), a.manager ? sql`true` : or(eq(crmContacts.assignedUserId, a.userId), exists(db.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.contactId, crmContacts.id), eq(crmOpportunities.assignedUserId, a.userId))))))!;
  }
  opportunityScope(a: CrmAccess) {
    return and(eq(crmOpportunities.companyId, a.companyId), a.manager ? sql`true` : eq(crmOpportunities.assignedUserId, a.userId))!;
  }
  entryScope(a: CrmAccess, db: CrmDb = this.database.db) {
    return and(eq(crmLeadEntries.companyId, a.companyId), exists(db.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(this.opportunityScope(a), eq(crmOpportunities.originEntryId, crmLeadEntries.id), eq(crmOpportunities.contactId, crmLeadEntries.contactId)))))!;
  }
  async contact(a: CrmAccess, id: string, db: CrmDb = this.database.db, lock = false) {
    const query = db.select().from(crmContacts).where(and(this.contactScope(a, db), eq(crmContacts.id, id))).limit(1);
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
  editContact(a: CrmAccess, c: typeof crmContacts.$inferSelect) {
    if (!a.manager && c.assignedUserId !== a.userId) throw new ForbiddenException('Somente o responsável pode alterar este contato');
  }
  requireManager(a: CrmAccess) { if (!a.manager) throw new ForbiddenException('Ação restrita à gestão'); }
  async assignee(a: CrmAccess, id: string | null, db: CrmDb, reassign = false) {
    if (!a.manager && (reassign || id !== a.userId)) throw new ForbiddenException('Sem permissão para atribuir outro responsável');
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

