import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { emailKeySchema } from '../emails/emails.schemas.js';
import { AccountsService } from './accounts.service.js';
const createSchema = z.strictObject({ name: z.string().trim().min(1).max(200) });
@ApiTags('Contratações') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('accounts')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}
  @Get() list(@Req() r: RequestContext) { return this.accounts.list(r.userId!); }
  @Post() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiBody({ schema: z.toJSONSchema(createSchema) as Record<string, unknown> })
  create(@Req() r: RequestContext, @Body() body: unknown) { return this.accounts.create(r.userId!, parseInput(createSchema, body).name, parseInput(emailKeySchema, r.headers['idempotency-key'])); }
}
