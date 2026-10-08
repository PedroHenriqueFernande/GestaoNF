import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { FinanceDatesService } from './finance-dates.service.js';
import { FinanceReadService } from './finance-read.service.js';
import { financeDateUpdateSchema, financeFiltersSchema, financeListSchema, financeSaleIdSchema } from './finance.schemas.js';

@ApiTags('Financeiro')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('finance/receivables')
export class FinanceController {
  constructor(
    @Inject(FinanceReadService) private readonly finance: FinanceReadService,
    @Inject(FinanceDatesService) private readonly dates: FinanceDatesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista recebimentos por venda, com filtros e paginação por pedido' })
  list(@Req() req: RequestContext, @Query() query: unknown) {
    return this.finance.list(req.companyId!, parseInput(financeListSchema, query));
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resume os recebimentos que atendem aos filtros' })
  summary(@Req() req: RequestContext, @Query() query: unknown) {
    return this.finance.summary(req.companyId!, parseInput(financeFiltersSchema, query));
  }

  @Get(':saleId')
  @ApiOperation({ summary: 'Detalha os recebimentos e movimentos de uma venda confirmada' })
  detail(@Req() req: RequestContext, @Param('saleId') saleId: string) {
    return this.finance.detail(req.companyId!, parseInput(financeSaleIdSchema, saleId));
  }

  @Patch(':saleId/payments/:installmentId/dates')
  @ApiOperation({ summary: 'Atualiza a data da venda e o vencimento de um recebimento' })
  @ApiBody({ schema: z.toJSONSchema(financeDateUpdateSchema, { io: 'input' }) as Record<string, unknown> })
  updateDates(@Req() req: RequestContext, @Param('saleId') saleId: string, @Param('installmentId') installmentId: string, @Body() body: unknown) {
    return this.dates.update(
      req.companyId!, parseInput(financeSaleIdSchema, saleId), parseInput(financeSaleIdSchema, installmentId),
      parseInput(financeDateUpdateSchema, body),
    );
  }
}
