import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, routeEntry, type RequestContext } from '../auth/access.guard.js';
import { RequirePermission } from '../permissions/permission.decorators.js';
import { parseInput } from '../common/validate.js';
import { SalesPaymentsService } from './sales-payments.service.js';
import { presentSale, SalesService } from './sales.service.js';
import { cancelSaleSchema, confirmSaleSchema, createSaleSchema, idempotencyKeySchema, listSalesSchema, receiptSchema, reverseReceiptSchema, saleIdSchema, updateConfirmedSaleSchema, updateSaleSchema, workOrderSchema } from './sales.schemas.js';

@ApiTags('Portal de Serviços')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('sales')
export class SalesController {
  constructor(@Inject(SalesService) private readonly service: SalesService, @Inject(SalesPaymentsService) private readonly payments: SalesPaymentsService) {}

  @Post()
  @RequirePermission('sales.create')
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID único por intenção de criação' })
  @ApiOperation({ summary: 'Cria rascunho e reserva código de pedido de cinco dígitos' })
  @ApiBody({ schema: z.toJSONSchema(createSaleSchema, { io: 'input' }) as Record<string, unknown> })
  async create(@Req() req: RequestContext, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return presentSale(req.actor!, await this.service.create(req.actor!, parseInput(idempotencyKeySchema, key), parseInput(createSaleSchema, body), routeEntry(req)));
  }

  @Get()
  @RequirePermission('sales.access')
  @ApiOperation({ summary: 'Lista vendas da empresa com filtros e paginação' })
  list(@Req() req: RequestContext, @Query() query: unknown) { return this.service.list(req.companyId!, parseInput(listSalesSchema, query)); }

  @Get(':id')
  @RequirePermission('sales.access')
  async get(@Req() req: RequestContext, @Param('id') id: string) { return presentSale(req.actor!, await this.service.get(req.companyId!, parseInput(saleIdSchema, id))); }

  @Patch(':id')
  @RequirePermission('sales.create')
  @ApiBody({ schema: z.toJSONSchema(updateSaleSchema, { io: 'input' }) as Record<string, unknown> })
  async update(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return presentSale(req.actor!, await this.service.update(req.actor!, parseInput(saleIdSchema, id), parseInput(updateSaleSchema, body), routeEntry(req)));
  }

  @Patch(':id/confirmed')
  @RequirePermission('sales.edit')
  @ApiOperation({ summary: 'Atualiza venda confirmada preservando códigos e histórico dos recebimentos' })
  @ApiBody({ schema: z.toJSONSchema(updateConfirmedSaleSchema, { io: 'input' }) as Record<string, unknown> })
  async updateConfirmed(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return presentSale(req.actor!, await this.service.updateConfirmed(req.actor!, parseInput(saleIdSchema, id), parseInput(updateConfirmedSaleSchema, body), routeEntry(req)));
  }

  @Post(':id/confirm')
  @RequirePermission('sales.create')
  @ApiBody({ schema: z.toJSONSchema(confirmSaleSchema, { io: 'input' }) as Record<string, unknown> })
  async confirm(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return presentSale(req.actor!, await this.service.confirm(req.actor!, parseInput(saleIdSchema, id), parseInput(confirmSaleSchema, body), routeEntry(req)));
  }

  @Patch(':id/work-order-number')
  @RequirePermission('sales.create')
  @ApiBody({ schema: z.toJSONSchema(workOrderSchema, { io: 'input' }) as Record<string, unknown> })
  async workOrder(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parseInput(workOrderSchema, body);
    return presentSale(req.actor!, await this.service.updateWorkOrder(req.companyId!, parseInput(saleIdSchema, id), req.userId!, input.expectedVersion, input.workOrderNumber));
  }

  @Post(':id/installments/:installmentId/receipts')
  @RequirePermission('finance.receive')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(receiptSchema, { io: 'input' }) as Record<string, unknown> })
  async receipt(@Req() req: RequestContext, @Param('id') id: string, @Param('installmentId') installmentId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return presentSale(req.actor!, await this.payments.receipt(req.companyId!, parseInput(saleIdSchema, id), parseInput(saleIdSchema, installmentId), req.userId!, parseInput(idempotencyKeySchema, key), parseInput(receiptSchema, body)));
  }

  @Post(':id/receipts/:movementId/reverse')
  @RequirePermission('finance.reverse')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(reverseReceiptSchema, { io: 'input' }) as Record<string, unknown> })
  async reverse(@Req() req: RequestContext, @Param('id') id: string, @Param('movementId') movementId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    const input = parseInput(reverseReceiptSchema, body);
    return presentSale(req.actor!, await this.payments.reverse(req.companyId!, parseInput(saleIdSchema, id), parseInput(saleIdSchema, movementId), req.userId!, parseInput(idempotencyKeySchema, key), input.reason));
  }

  @Post(':id/cancel')
  @RequirePermission('sales.delete')
  @ApiBody({ schema: z.toJSONSchema(cancelSaleSchema, { io: 'input' }) as Record<string, unknown> })
  async cancel(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parseInput(cancelSaleSchema, body);
    return presentSale(req.actor!, await this.service.cancel(req.companyId!, parseInput(saleIdSchema, id), req.userId!, input.expectedVersion, input.reason));
  }

  @Get(':id/history')
  @RequirePermission('sales.access')
  history(@Req() req: RequestContext, @Param('id') id: string) { return this.service.history(req.companyId!, parseInput(saleIdSchema, id)); }
}
