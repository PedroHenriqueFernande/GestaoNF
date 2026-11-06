import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { beginUploadSchema, fileAccessSchema, fileIdSchema, fileListSchema, uploadKeySchema } from './files.schemas.js';
import { FilesService } from './files.service.js';

@ApiTags('Arquivos privados') @ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('files')
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}
  @Get('capabilities')
  @ApiOperation({ summary: 'Consulta disponibilidade e limites de upload' })
  capabilities(@Req() request: RequestContext) { return this.files.capabilities(this.ctx(request)); }
  @Post('uploads')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(beginUploadSchema, { io: 'input' }) as Record<string, unknown> })
  @ApiOperation({ summary: 'Reserva arquivo e gera PUT temporário para o R2 privado' })
  begin(@Req() request: RequestContext, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    return this.files.begin(this.ctx(request), parseInput(beginUploadSchema, body), parseInput(uploadKeySchema, request.headers['idempotency-key']));
  }
  @Post(':id/complete') @HttpCode(200)
  @ApiOperation({ summary: 'Valida bytes, processa imagem e disponibiliza arquivo; repetição é idempotente' })
  complete(@Req() request: RequestContext, @Param('id') id: string) { return this.files.complete(this.ctx(request), parseInput(fileIdSchema, id)); }
  @Get()
  @ApiOperation({ summary: 'Lista apenas arquivos disponíveis no escopo do usuário' })
  @ApiQuery({ name: 'kind', required: false, enum: ['ALL', 'IMAGE', 'PDF'] })
  list(@Req() request: RequestContext, @Query() query: unknown) { return this.files.list(this.ctx(request), parseInput(fileListSchema, query)); }
  @Get(':id/access')
  @ApiOperation({ summary: 'Autoriza download temporário; PDF sempre como attachment' })
  @ApiQuery({ name: 'disposition', required: false, enum: ['inline', 'attachment'] })
  download(@Req() request: RequestContext, @Param('id') id: string, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    return this.files.download(this.ctx(request), parseInput(fileIdSchema, id), parseInput(fileAccessSchema, query).disposition);
  }
  @Get(':id')
  get(@Req() request: RequestContext, @Param('id') id: string) { return this.files.get(this.ctx(request), parseInput(fileIdSchema, id)); }
  @Delete(':id') @HttpCode(204)
  @ApiOperation({ summary: 'Cancela upload ou exclui arquivo sem venda; remoção física pelo worker' })
  remove(@Req() request: RequestContext, @Param('id') id: string) { return this.files.remove(this.ctx(request), parseInput(fileIdSchema, id)); }
  private ctx(request: RequestContext) { return { companyId: request.companyId!, userId: request.userId! }; }
}
