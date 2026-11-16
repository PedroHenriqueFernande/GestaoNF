import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { beginImageUploadSchema } from '../files/image-normalize.js';
import { emptySchema, logoFileIdSchema, logoUploadKeySchema, setCompanyLogoSchema } from './company-logo.schemas.js';
import { CompanyLogoService } from './company-logo.service.js';

@ApiTags('Empresas') @ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('companies')
export class CompanyLogoController {
  constructor(@Inject(CompanyLogoService) private readonly logos: CompanyLogoService) {}

  @Get('logos/access')
  @ApiOperation({ summary: 'Links temporários (120 s) das miniaturas das empresas do usuário' })
  access(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(emptySchema, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    return this.logos.access(request.userId!);
  }

  @Post('current/logo/uploads')
  @UseGuards(CompanyGuard)
  @ApiHeader({ name: 'X-Company-Id', required: true }) @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(beginImageUploadSchema, { io: 'input' }) as Record<string, unknown> })
  @ApiOperation({ summary: 'Reserva envio da foto da empresa e gera PUT temporário para o R2 privado (OWNER/ADMIN)' })
  async begin(@Req() request: RequestContext, @Body() body: unknown, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(emptySchema, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    const result = await this.logos.begin(this.ctx(request), parseInput(beginImageUploadSchema, body), parseInput(logoUploadKeySchema, request.headers['idempotency-key']));
    if (!result.upload) reply.code(200);
    return result;
  }

  @Post('current/logo/uploads/:id/complete') @HttpCode(200)
  @UseGuards(CompanyGuard)
  @ApiHeader({ name: 'X-Company-Id', required: true })
  @ApiOperation({ summary: 'Valida a imagem, gera as variantes WebP e deixa a foto pronta; repetição é idempotente' })
  complete(@Req() request: RequestContext, @Param('id') id: string, @Body() body: unknown, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(emptySchema, body === undefined ? {} : body);
    parseInput(emptySchema, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    return this.logos.complete(this.ctx(request), parseInput(logoFileIdSchema, id));
  }

  @Put('current/logo')
  @UseGuards(CompanyGuard)
  @ApiHeader({ name: 'X-Company-Id', required: true })
  @ApiBody({ schema: z.toJSONSchema(setCompanyLogoSchema, { io: 'input' }) as Record<string, unknown> })
  @ApiOperation({ summary: 'Associa a foto pronta à empresa ou remove com logoId null (OWNER/ADMIN)' })
  setLogo(@Req() request: RequestContext, @Body() body: unknown, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    parseInput(emptySchema, query ?? {});
    reply.header('Cache-Control', 'private, no-store');
    return this.logos.setLogo(this.ctx(request), parseInput(setCompanyLogoSchema, body).logoId);
  }

  private ctx(request: RequestContext) { return { companyId: request.companyId!, userId: request.userId! }; }
}
