import { applyDecorators, Body, Controller, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { idSchema, keySchema, pageSchema } from './crm.schemas.js';
import { createProposalSchema, updateProposalSchema, proposalCommandSchema, declineProposalSchema, duplicateProposalSchema, proposalListSchema, proposalPrefillSchema, proposalSettingsSchema } from './proposal.schemas.js';
import { ProposalsService } from './proposals.service.js';
import { ProposalReadService } from './proposal-read.service.js';
import { ProposalDocumentService } from './proposal-document.service.js';
const body = (s: z.ZodType) => ({ schema: z.toJSONSchema(s, { io: 'input' }) as Record<string, unknown> });
const query = (s: z.ZodType) => applyDecorators(...Object.entries(z.toJSONSchema(s, { io: 'input' }).properties ?? {}).map(([name, field]) => ApiQuery({ name, required: false, schema: field as Record<string, unknown> })));
const ctx = (r: RequestContext) => ({ companyId: r.companyId!, userId: r.userId! });
@ApiTags('CRM · Propostas')
@ApiBearerAuth() @ApiHeader({ name: 'X-Company-Id', required: true }) @UseGuards(AccessGuard, CompanyGuard)
@Controller('crm')
export class ProposalsController {
  constructor(@Inject(ProposalsService) private readonly proposals: ProposalsService, @Inject(ProposalReadService) private readonly read: ProposalReadService,
    @Inject(ProposalDocumentService) private readonly documents: ProposalDocumentService) {}
  @Get('proposals/prefill') @query(proposalPrefillSchema)
  prefill(@Req() r: RequestContext, @Query() q: unknown) { return this.read.prefill(ctx(r), parseInput(proposalPrefillSchema, q)); }
  @Post('proposals') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(createProposalSchema))
  @ApiOperation({ summary: 'Cria proposta e cadastro de cliente necessário na mesma transação' })
  create(@Req() r: RequestContext, @Body() b: unknown, @Headers('idempotency-key') k: unknown) { return this.proposals.create(ctx(r), parseInput(createProposalSchema, b), parseInput(keySchema, k)); }
  @Get('proposals') @query(proposalListSchema)
  list(@Req() r: RequestContext, @Query() q: unknown) { return this.read.list(ctx(r), parseInput(proposalListSchema, q)); }
  @Get('opportunities/:id/proposals') @query(proposalListSchema)
  async forOpportunity(@Req() r: RequestContext, @Param('id') id: unknown, @Query() q: unknown) {
    const opportunityId = parseInput(idSchema, id); await this.read.prefill(ctx(r), { opportunityId });
    return this.read.list(ctx(r), { ...parseInput(proposalListSchema, q), opportunityId });
  }
  @Get('proposal-settings')
  settings(@Req() r: RequestContext) { return this.proposals.settings(ctx(r)); }
  @Patch('proposal-settings') @ApiBody(body(proposalSettingsSchema))
  updateSettings(@Req() r: RequestContext, @Body() b: unknown) { return this.proposals.updateSettings(ctx(r), b); }
  @Get('proposals/:id')
  get(@Req() r: RequestContext, @Param('id') id: unknown) { return this.proposals.get(ctx(r), parseInput(idSchema, id)); }
  @Patch('proposals/:id') @ApiBody(body(updateProposalSchema))
  update(@Req() r: RequestContext, @Param('id') id: unknown, @Body() b: unknown) { return this.proposals.update(ctx(r), parseInput(idSchema, id), parseInput(updateProposalSchema, b)); }
  @Post('proposals/:id/send') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(proposalCommandSchema))
  @ApiOperation({ summary: 'Congela documento e registra envio realizado pelo usuário' })
  send(@Req() r: RequestContext, @Param('id') id: unknown, @Body() b: unknown, @Headers('idempotency-key') k: unknown) { return this.proposals.transition(ctx(r), parseInput(idSchema, id), 'send', parseInput(proposalCommandSchema, b), parseInput(keySchema, k)); }
  @Post('proposals/:id/accept') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(proposalCommandSchema))
  accept(@Req() r: RequestContext, @Param('id') id: unknown, @Body() b: unknown, @Headers('idempotency-key') k: unknown) { return this.proposals.transition(ctx(r), parseInput(idSchema, id), 'accept', parseInput(proposalCommandSchema, b), parseInput(keySchema, k)); }
  @Post('proposals/:id/decline') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(declineProposalSchema))
  decline(@Req() r: RequestContext, @Param('id') id: unknown, @Body() b: unknown, @Headers('idempotency-key') k: unknown) { return this.proposals.transition(ctx(r), parseInput(idSchema, id), 'decline', parseInput(declineProposalSchema, b), parseInput(keySchema, k)); }
  @Post('proposals/:id/duplicate') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(duplicateProposalSchema))
  duplicate(@Req() r: RequestContext, @Param('id') id: unknown, @Body() b: unknown, @Headers('idempotency-key') k: unknown) { return this.proposals.duplicate(ctx(r), parseInput(idSchema, id), parseInput(duplicateProposalSchema, b), parseInput(keySchema, k)); }
  @Post('proposals/:id/convert') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody(body(proposalCommandSchema))
  convert(@Req() r: RequestContext, @Param('id') id: unknown, @Body() b: unknown, @Headers('idempotency-key') k: unknown) { return this.proposals.convert(ctx(r), parseInput(idSchema, id), parseInput(proposalCommandSchema, b), parseInput(keySchema, k)); }
  @Get('proposals/:id/history') @query(pageSchema)
  history(@Req() r: RequestContext, @Param('id') id: unknown, @Query() q: unknown) { const page = parseInput(pageSchema, q); return this.proposals.events(ctx(r), parseInput(idSchema, id), page.limit, page.offset); }
  @Get('proposals/:id/preview')
  preview(@Req() r: RequestContext, @Param('id') id: unknown) { return this.proposals.preview(ctx(r), parseInput(idSchema, id)); }
  @Get('proposals/:id/pdf') @ApiProduces('application/pdf')
  async pdf(@Req() r: RequestContext, @Param('id') id: unknown, @Res() reply: FastifyReply) {
    const pdf = await this.documents.pdf(ctx(r), parseInput(idSchema, id));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="${pdf.filename}"`).header('Cache-Control', 'private, no-store').send(pdf.bytes);
  }
}
