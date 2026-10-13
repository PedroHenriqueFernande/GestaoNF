import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { WhatsAppLinkService } from './whatsapp-link.service.js';
import { z } from 'zod';

@ApiTags('Nero / WhatsApp')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('integrations/whatsapp/link')
export class WhatsAppLinkController {
  constructor(@Inject(WhatsAppLinkService) private readonly links: WhatsAppLinkService) {}

  @Get('status')
  status(@Req() request: RequestContext) { return this.links.status(request.userId!, request.companyId!); }

  @Post('challenges')
  create(@Req() request: RequestContext, @Body() body: unknown) {
    const input = z.object({ mode: z.enum(['NEW_NUMBER', 'EXISTING_NUMBER']).optional(), linkId: z.uuid().optional() }).strict().safeParse(body ?? {});
    if (!input.success) throw new BadRequestException('Opção de vínculo inválida');
    return this.links.createChallenge(request.userId!, request.companyId!, input.data);
  }

  @Get('challenges/:challengeId')
  challenge(@Req() request: RequestContext, @Param('challengeId') challengeId: string) {
    if (!z.uuid().safeParse(challengeId).success) throw new BadRequestException('Identificador de vínculo inválido');
    return this.links.challengeStatus(request.userId!, request.companyId!, challengeId);
  }

  @Post('challenges/:challengeId/confirm')
  confirm(@Req() request: RequestContext, @Param('challengeId') challengeId: string) {
    if (!z.uuid().safeParse(challengeId).success) throw new BadRequestException('Identificador de vínculo inválido');
    return this.links.confirm(request.userId!, request.companyId!, challengeId);
  }

  @Delete()
  @HttpCode(204)
  disconnect(@Req() request: RequestContext) { return this.links.disconnect(request.userId!, request.companyId!); }
}
