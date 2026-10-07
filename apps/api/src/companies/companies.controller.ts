import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { companies, companyUsers } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { AccessGuard, type RequestContext } from '../auth/access.guard.js';
import { DatabaseService } from '../database/database.module.js';

@ApiTags('Empresas')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('companies')
export class CompaniesController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get()
  async list(@Req() request: RequestContext) {
    return this.database.db.select({ id: companies.id, name: companies.name, role: companyUsers.role }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .where(and(eq(companyUsers.userId, request.userId!), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE')));
  }
}
