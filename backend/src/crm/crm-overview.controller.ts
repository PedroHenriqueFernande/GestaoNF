import { applyDecorators, Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccessGuard, type RequestContext } from '../auth/access.guard.js';
import { CompanyScopeGuard, scopeQueryFields } from '../auth/company-scope.guard.js';
import { parseInput } from '../common/validate.js';
import { can } from '../permissions/actor.js';
import { RequireAnyPermission, RequirePermission } from '../permissions/permission.decorators.js';
import { listOverviewSchema } from './crm.schemas.js';
import { LeadsService } from './leads.service.js';
import { meetingListOverviewSchema } from './meeting.schemas.js';
import { MeetingsService } from './meetings.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { ProposalReadService } from './proposal-read.service.js';
import { proposalListOverviewSchema } from './proposal.schemas.js';

const scopeOnlySchema = z.strictObject(scopeQueryFields);
const scopeDoc = () => applyDecorators(
  ApiQuery({ name: 'companies', required: false, enum: ['all'] }),
  ApiQuery({ name: 'companyIds', required: false, description: 'UUIDs separados por vírgula (até 50)' }),
);

async function consolidated<T extends object>(reply: FastifyReply, companyIds: string[], read: Promise<T>) {
  reply.header('Cache-Control', 'private, no-store');
  return { ...(await read), companyIds };
}

@ApiTags('CRM')
@ApiBearerAuth()
@UseGuards(AccessGuard, CompanyScopeGuard)
@Controller('crm/overview')
export class CrmOverviewController {
  constructor(
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(OpportunitiesService) private readonly opportunities: OpportunitiesService,
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(ProposalReadService) private readonly proposals: ProposalReadService,
  ) {}

  @Get('leads') @RequirePermission('crm.access') @scopeDoc()
  @ApiOperation({ summary: 'Leads de várias empresas (somente leitura)' })
  listLeads(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const companyIds = request.companyIds!;
    return consolidated(reply, companyIds, this.leads.overview(companyIds, parseInput(listOverviewSchema, query ?? {})));
  }

  @Get('opportunities') @RequirePermission('crm.access') @scopeDoc()
  @ApiOperation({ summary: 'Negociações de várias empresas (somente leitura)' })
  listOpportunities(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const companyIds = request.companyIds!;
    const priceCompanyIds = request.companyActors!.filter(actor => can(actor, 'services.access')).map(actor => actor.companyId);
    return consolidated(reply, companyIds, this.opportunities.overview(companyIds, parseInput(listOverviewSchema, query ?? {}), priceCompanyIds));
  }

  @Get('meetings') @RequirePermission('agenda.access') @scopeDoc()
  @ApiOperation({ summary: 'Reuniões de várias empresas com resumo da agenda (somente leitura)' })
  listMeetings(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const companyIds = request.companyIds!;
    return consolidated(reply, companyIds, this.meetings.overview(companyIds, parseInput(meetingListOverviewSchema, query ?? {})));
  }

  @Get('proposals') @RequirePermission('proposals.access') @scopeDoc()
  @ApiOperation({ summary: 'Propostas de várias empresas (somente leitura)' })
  listProposals(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const companyIds = request.companyIds!;
    return consolidated(reply, companyIds, this.proposals.overview(companyIds, parseInput(proposalListOverviewSchema, query ?? {})));
  }

  @Get('responsibles') @RequireAnyPermission(['crm.access', 'agenda.access', 'proposals.access']) @scopeDoc()
  @ApiOperation({ summary: 'Responsáveis ativos de várias empresas (somente leitura)' })
  listResponsibles(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(scopeOnlySchema, query ?? {});
    const companyIds = request.companyIds!;
    return consolidated(reply, companyIds, this.meetings.overviewResponsibles(companyIds));
  }
}
