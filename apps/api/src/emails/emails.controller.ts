import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { emailKeySchema, emailListSchema, sendEmailSchema, testEmailSchema } from './emails.schemas.js';
import { EmailsService } from './emails.service.js';

@ApiTags('E-mails') @ApiBearerAuth() @ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard) @Controller('emails')
export class EmailsController {
  constructor(@Inject(EmailsService) private readonly emails: EmailsService) {}
  private ctx(r: RequestContext) { return { companyId: r.companyId!, userId: r.userId! }; }
  @Get('capabilities') @ApiOperation({ summary: 'Disponibilidade e modo de testes do envio de e-mails' })
  capabilities(@Req() r: RequestContext) { return this.emails.capabilities(this.ctx(r)); }
  @Post('test') @HttpCode(202) @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(testEmailSchema, { io: 'input' }) as Record<string, unknown> })
  @ApiOperation({ summary: 'Enfileira teste para a conta Resend ou destinatário de simulação' })
  test(@Req() r: RequestContext, @Body() body: unknown) { return this.emails.test(this.ctx(r), parseInput(testEmailSchema, body).scenario, parseInput(emailKeySchema, r.headers['idempotency-key'])); }
  @Post() @HttpCode(202) @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(sendEmailSchema, { io: 'input' }) as Record<string, unknown> })
  @ApiOperation({ summary: 'Enfileira e-mail de texto com template do GestãoNF; somente gestores' })
  send(@Req() r: RequestContext, @Body() body: unknown) { return this.emails.send(this.ctx(r), parseInput(sendEmailSchema, body), parseInput(emailKeySchema, r.headers['idempotency-key'])); }
  @Get() list(@Req() r: RequestContext, @Query() q: unknown) { return this.emails.list(this.ctx(r), parseInput(emailListSchema, q)); }
  @Get(':id') get(@Req() r: RequestContext, @Param('id') id: string) { return this.emails.get(this.ctx(r), parseInput(z.uuid(), id)); }
}

@ApiTags('E-mails') @Controller('integrations/email/resend')
export class ResendWebhookController {
  constructor(@Inject(EmailsService) private readonly emails: EmailsService) {}
  @Post('webhook') @HttpCode(200) @ApiOperation({ summary: 'Recebe eventos Resend com assinatura Svix e deduplicação' })
  webhook(@Req() r: RequestContext & { rawBody?: string }) {
    const id = r.headers['svix-id'], timestamp = r.headers['svix-timestamp'], signature = r.headers['svix-signature'];
    if (!r.rawBody || typeof id !== 'string' || id.length > 200 || typeof timestamp !== 'string' || typeof signature !== 'string') throw new BadRequestException('Corpo e cabeçalhos Svix necessários');
    return this.emails.webhook(r.rawBody, { id, timestamp, signature });
  }
}
