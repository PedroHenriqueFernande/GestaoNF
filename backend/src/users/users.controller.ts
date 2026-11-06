import { Body, Controller, Get, Header, HttpCode, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccessGuard, type RequestContext } from '../auth/access.guard.js';
import { authResponse } from '../auth/auth-response.js';
import { parseInput } from '../common/validate.js';
import { emailKeySchema } from '../emails/emails.schemas.js';
import { acceptNewSchema, createInvitationSchema, invitationCompaniesSchema, invitationVersionSchema, membershipSelectionSchema, previewSchema, userListSchema } from './users.schemas.js';
import { UsersService } from './users.service.js';
import { InvitationThrottleService } from './invitation-throttle.service.js';

const bodyDoc = (schema: z.ZodType) => ApiBody({ schema: z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown> });
const keyDoc = () => ApiHeader({ name: 'Idempotency-Key', required: true });
@ApiTags('Usuários e convites') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('accounts/:accountId')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}
  private ids(accountId: string, id?: string) { return { accountId: parseInput(z.uuid(), accountId), ...(id ? { id: parseInput(z.uuid(), id) } : {}) }; }
  private key(r: RequestContext) { return parseInput(emailKeySchema, r.headers['idempotency-key']); }
  @Get('users') @ApiOperation({ summary: 'Lista membros e convites da contratação do titular' })
  list(@Req() r: RequestContext, @Param('accountId') accountId: string, @Query() query: unknown) { return this.users.list(this.ids(accountId).accountId, r.userId!, parseInput(userListSchema, query)); }
  @Get('users/capacity')
  capacity(@Req() r: RequestContext, @Param('accountId') accountId: string) { return this.users.capacity(this.ids(accountId).accountId, r.userId!); }
  @Get('users/companies')
  companies(@Req() r: RequestContext, @Param('accountId') accountId: string) { return this.users.capacity(this.ids(accountId).accountId, r.userId!); }
  @Post('user-invitations') @HttpCode(202) @keyDoc() @bodyDoc(createInvitationSchema)
  create(@Req() r: RequestContext, @Param('accountId') accountId: string, @Body() body: unknown) { return this.users.create(this.ids(accountId).accountId, r.userId!, parseInput(createInvitationSchema, body), this.key(r)); }
  @Post('user-invitations/:id/resend') @HttpCode(202) @keyDoc() @bodyDoc(invitationVersionSchema)
  resend(@Req() r: RequestContext, @Param('accountId') a: string, @Param('id') id: string, @Body() body: unknown) { const ids = this.ids(a, id); return this.users.rotate(ids.accountId, r.userId!, ids.id!, parseInput(invitationVersionSchema, body).version, this.key(r)); }
  @Patch('user-invitations/:id/companies') @keyDoc() @bodyDoc(invitationCompaniesSchema)
  targets(@Req() r: RequestContext, @Param('accountId') a: string, @Param('id') id: string, @Body() body: unknown) { const ids = this.ids(a, id), input = parseInput(invitationCompaniesSchema, body); return this.users.rotate(ids.accountId, r.userId!, ids.id!, input.version, this.key(r), input.companyIds); }
  @Post('user-invitations/:id/revoke') @HttpCode(200) @keyDoc() @bodyDoc(invitationVersionSchema)
  revoke(@Req() r: RequestContext, @Param('accountId') a: string, @Param('id') id: string, @Body() body: unknown) { const ids = this.ids(a, id); return this.users.revoke(ids.accountId, r.userId!, ids.id!, parseInput(invitationVersionSchema, body).version, this.key(r)); }
  @Patch('users/:id/companies') @keyDoc() @bodyDoc(membershipSelectionSchema)
  memberships(@Req() r: RequestContext, @Param('accountId') a: string, @Param('id') id: string, @Body() body: unknown) { const ids = this.ids(a, id), input = parseInput(membershipSelectionSchema, body); return this.users.updateCompanies(ids.accountId, r.userId!, ids.id!, input.companyIds, input.version, this.key(r)); }
  @Post('users/:id/deactivate') @HttpCode(200) @keyDoc() @bodyDoc(z.strictObject({ version: z.string().length(64) }))
  deactivate(@Req() r: RequestContext, @Param('accountId') a: string, @Param('id') id: string, @Body() body: unknown) { const ids = this.ids(a, id); return this.users.updateCompanies(ids.accountId, r.userId!, ids.id!, [], parseInput(z.strictObject({ version: z.string().length(64) }), body).version, this.key(r)); }
}
@ApiTags('Aceite de convites') @Controller('user-invitations')
export class InvitationAcceptanceController {
  constructor(@Inject(UsersService) private readonly users: UsersService, @Inject(InvitationThrottleService) private readonly throttle: InvitationThrottleService) {}
  @Post('preview') @HttpCode(200) @Header('Cache-Control', 'no-store') @bodyDoc(previewSchema)
  async preview(@Req() r: RequestContext, @Body() body: unknown) { await this.throttle.check(r.ip, 'preview'); return this.users.preview(parseInput(previewSchema, body).token); }
  @Post('accept-new') @HttpCode(201) @Header('Cache-Control', 'no-store') @bodyDoc(acceptNewSchema)
  async acceptNew(@Req() r: RequestContext, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) { await this.throttle.check(r.ip, 'accept'); const input = parseInput(acceptNewSchema, body); return authResponse(await this.users.acceptNew(input.token, input.password), input.client, reply); }
  @Post('accept-existing') @HttpCode(200) @Header('Cache-Control', 'no-store') @UseGuards(AccessGuard) @ApiBearerAuth() @bodyDoc(previewSchema)
  async acceptExisting(@Req() r: RequestContext, @Body() body: unknown) { await this.throttle.check(r.ip, 'accept'); return this.users.acceptExisting(parseInput(previewSchema, body).token, r.userId!); }
}
