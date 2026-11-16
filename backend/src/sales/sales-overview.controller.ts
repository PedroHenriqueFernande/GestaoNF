import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AccessGuard, type RequestContext } from '../auth/access.guard.js';
import { CompanyScopeGuard } from '../auth/company-scope.guard.js';
import { parseInput } from '../common/validate.js';
import { listSalesOverviewSchema } from './sales.schemas.js';
import { SalesService } from './sales.service.js';

@ApiTags('Portal de Serviços') @ApiBearerAuth()
@UseGuards(AccessGuard, CompanyScopeGuard)
@Controller('sales/overview')
export class SalesOverviewController {
  constructor(@Inject(SalesService) private readonly service: SalesService) {}
  @Get()
  @ApiOperation({ summary: 'Lista consolidada (somente leitura) de pedidos de várias empresas, com total somado' })
  @ApiQuery({ name: 'companies', required: false, enum: ['all'] })
  @ApiQuery({ name: 'companyIds', required: false, description: 'UUIDs separados por vírgula (até 50)' })
  list(@Req() request: RequestContext, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'private, no-store');
    return this.service.overview(request.companyIds!, parseInput(listSalesOverviewSchema, query ?? {}));
  }
}
