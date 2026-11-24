import { applyDecorators, Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { RequireAllPermissions, RequirePermission } from '../permissions/permission.decorators.js';
import { parseInput } from '../common/validate.js';
import { LeadCaptureService } from './lead-capture.service.js';
import { LeadsService } from './leads.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { CrmHistoryService } from './crm-history.service.js';
import { candidatesSchema, captureOptionsSchema, createEntrySchema, createLeadSchema, customerLinkSchema, idSchema, keySchema, listSchema, noteSchema, pageSchema, stageSchema, statusSchema, updateLeadSchema, updateOpportunitySchema, versionSchema } from './crm.schemas.js';

const bodySchema = (schema: z.ZodType) => ({ schema: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown> });
const querySchema = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { io: 'input' });
  return applyDecorators(...Object.entries(json.properties ?? {}).map(([name, field]) => ApiQuery({ name, required: false, schema: field as Record<string, unknown> })));
};
const ctx = (r: RequestContext) => ({ companyId: r.companyId!, userId: r.userId! });
@ApiTags('CRM')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true, description: 'Empresa autorizada do usuário' })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('crm')
export class CrmController {
  constructor(@Inject(LeadCaptureService) private readonly capture: LeadCaptureService,
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(CrmHistoryService) private readonly history: CrmHistoryService) {}

  @Post('leads')
  @RequirePermission('crm.create')
  @ApiOperation({ summary: 'Cria lead, captação e card inicial automaticamente' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody(bodySchema(createLeadSchema))
  create(@Req() r: RequestContext, @Body() body: unknown, @Headers('idempotency-key') key: unknown) {
    return this.capture.create(ctx(r), parseInput(createLeadSchema, body), parseInput(keySchema, key));
  }
  @Get('leads')
  @RequirePermission('crm.access')
  @ApiOperation({ summary: 'Lista contatos autorizados com filtros comerciais e UTMs' })
  @querySchema(listSchema)
  list(@Req() r: RequestContext, @Query() query: unknown) { return this.leads.list(ctx(r), parseInput(listSchema, query)); }
  @Post('leads/duplicate-candidates')
  @RequirePermission('crm.access')
  @HttpCode(200)
  @ApiBody(bodySchema(candidatesSchema))
  candidates(@Req() r: RequestContext, @Body() body: unknown) { return this.leads.candidates(ctx(r), parseInput(candidatesSchema, body)); }
  @Get('leads/:id')
  @RequirePermission('crm.access')
  get(@Req() r: RequestContext, @Param('id') id: string) { return this.leads.get(ctx(r), parseInput(idSchema, id)); }
  @Patch('leads/:id')
  @RequirePermission('crm.edit')
  @ApiBody(bodySchema(updateLeadSchema))
  update(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.leads.update(ctx(r), parseInput(idSchema, id), parseInput(updateLeadSchema, body)); }
  @Get('leads/:id/entries')
  @RequirePermission('crm.access')
  @querySchema(pageSchema)
  entries(@Req() r: RequestContext, @Param('id') id: string, @Query() query: unknown) { return this.leads.entries(ctx(r), parseInput(idSchema, id), parseInput(pageSchema, query)); }
  @Post('leads/:id/entries')
  @RequirePermission('crm.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody(bodySchema(createEntrySchema))
  addEntry(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: unknown) { return this.capture.addEntry(ctx(r), parseInput(idSchema, id), parseInput(createEntrySchema, body), parseInput(keySchema, key)); }
  @Get('leads/:id/history')
  @RequirePermission('crm.access')
  @querySchema(pageSchema)
  listHistory(@Req() r: RequestContext, @Param('id') id: string, @Query() query: unknown) { return this.history.list(ctx(r), parseInput(idSchema, id), parseInput(pageSchema, query)); }
  @Post('leads/:id/notes')
  @RequirePermission('crm.edit')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody(bodySchema(noteSchema))
  addNote(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown, @Headers('idempotency-key') key: unknown) { return this.leads.addNote(ctx(r), parseInput(idSchema, id), parseInput(noteSchema, body), parseInput(keySchema, key)); }
  @Put('leads/:id/customer-link')
  @RequireAllPermissions(['crm.edit', 'customers.access'])
  @ApiBody(bodySchema(customerLinkSchema))
  linkCustomer(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.leads.linkCustomer(ctx(r), parseInput(idSchema, id), parseInput(customerLinkSchema, body)); }
  @Post('leads/:id/archive')
  @RequirePermission('crm.archive')
  @HttpCode(200)
  @ApiBody(bodySchema(versionSchema))
  archiveLead(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.leads.archive(ctx(r), parseInput(idSchema, id), parseInput(versionSchema, body).expectedVersion); }
  @Post('leads/:id/restore')
  @RequirePermission('crm.archive')
  @HttpCode(200)
  @ApiBody(bodySchema(versionSchema))
  restoreLead(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.leads.archive(ctx(r), parseInput(idSchema, id), parseInput(versionSchema, body).expectedVersion, true); }
  @Get('opportunities')
  @RequirePermission('crm.access')
  @querySchema(listSchema)
  listOpportunities(@Req() r: RequestContext, @Query() query: unknown) { return this.opportunities.list(ctx(r), parseInput(listSchema, query)); }
  @Get('opportunities/:id')
  @RequirePermission('crm.access')
  getOpportunity(@Req() r: RequestContext, @Param('id') id: string) { return this.opportunities.get(ctx(r), parseInput(idSchema, id)); }
  @Patch('opportunities/:id')
  @RequirePermission('crm.edit')
  @ApiBody(bodySchema(updateOpportunitySchema))
  updateOpportunity(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.opportunities.update(ctx(r), parseInput(idSchema, id), parseInput(updateOpportunitySchema, body)); }
  @Patch('opportunities/:id/status')
  @RequirePermission('crm.edit')
  @ApiBody(bodySchema(statusSchema))
  status(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.opportunities.status(ctx(r), parseInput(idSchema, id), parseInput(statusSchema, body)); }
  @Patch('opportunities/:id/stage')
  @RequirePermission('crm.edit')
  @ApiBody(bodySchema(stageSchema))
  stage(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.opportunities.stage(ctx(r), parseInput(idSchema, id), parseInput(stageSchema, body)); }
  @Post('opportunities/:id/archive')
  @RequirePermission('crm.archive')
  @HttpCode(200)
  @ApiBody(bodySchema(versionSchema))
  archiveOpportunity(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.opportunities.archive(ctx(r), parseInput(idSchema, id), parseInput(versionSchema, body).expectedVersion); }
  @Post('opportunities/:id/restore')
  @RequirePermission('crm.archive')
  @HttpCode(200)
  @ApiBody(bodySchema(versionSchema))
  restoreOpportunity(@Req() r: RequestContext, @Param('id') id: string, @Body() body: unknown) { return this.opportunities.archive(ctx(r), parseInput(idSchema, id), parseInput(versionSchema, body).expectedVersion, true); }
  @Get('pipelines')
  @RequirePermission('crm.access')
  pipelines(@Req() r: RequestContext) { return this.opportunities.pipelines(ctx(r)); }
  @Get('capture-options')
  @RequirePermission('crm.access')
  @querySchema(captureOptionsSchema)
  options(@Req() r: RequestContext, @Query() query: unknown) { return this.leads.captureOptions(ctx(r), parseInput(captureOptionsSchema, query)); }
}

