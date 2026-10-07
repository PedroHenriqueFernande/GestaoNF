import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { SalesPaymentsService } from './sales-payments.service.js';
import { SalesService } from './sales.service.js';
import { cancelSaleSchema, confirmSaleSchema, createSaleSchema, idempotencyKeySchema, listSalesSchema, receiptSchema, reverseReceiptSchema, saleIdSchema, updateSaleSchema, workOrderSchema } from './sales.schemas.js';

@ApiTags('Portal de Serviços')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('sales')
export class SalesController {
  constructor(@Inject(SalesService) private readonly service: SalesService, @Inject(SalesPaymentsService) private readonly payments: SalesPaymentsService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID único por intenção de criação' })
  @ApiOperation({ summary: 'Cria rascunho e reserva código de pedido de cinco dígitos' })
  @ApiBody({ schema: z.toJSONSchema(createSaleSchema, { io: 'input' }) as Record<string, unknown> })
  create(@Req() req: RequestContext, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.service.create(req.companyId!, req.userId!, parseInput(idempotencyKeySchema, key), parseInput(createSaleSchema, body));
  }

  @Get()
  @ApiOperation({ summary: 'Lista vendas da empresa com filtros e paginação' })
  list(@Req() req: RequestContext, @Query() query: unknown) { return this.service.list(req.companyId!, parseInput(listSalesSchema, query)); }

  @Get(':id')
  get(@Req() req: RequestContext, @Param('id') id: string) { return this.service.get(req.companyId!, parseInput(saleIdSchema, id)); }

  @Patch(':id')
  @ApiBody({ schema: z.toJSONSchema(updateSaleSchema, { io: 'input' }) as Record<string, unknown> })
  update(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.update(req.companyId!, parseInput(saleIdSchema, id), req.userId!, parseInput(updateSaleSchema, body));
  }

  @Post(':id/confirm')
  @ApiBody({ schema: z.toJSONSchema(confirmSaleSchema, { io: 'input' }) as Record<string, unknown> })
  confirm(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.confirm(req.companyId!, parseInput(saleIdSchema, id), req.userId!, parseInput(confirmSaleSchema, body));
  }

  @Patch(':id/work-order-number')
  @ApiBody({ schema: z.toJSONSchema(workOrderSchema, { io: 'input' }) as Record<string, unknown> })
  workOrder(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parseInput(workOrderSchema, body);
    return this.service.updateWorkOrder(req.companyId!, parseInput(saleIdSchema, id), req.userId!, input.expectedVersion, input.workOrderNumber);
  }

  @Post(':id/installments/:installmentId/receipts')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(receiptSchema, { io: 'input' }) as Record<string, unknown> })
  receipt(@Req() req: RequestContext, @Param('id') id: string, @Param('installmentId') installmentId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.payments.receipt(req.companyId!, parseInput(saleIdSchema, id), parseInput(saleIdSchema, installmentId), req.userId!, parseInput(idempotencyKeySchema, key), parseInput(receiptSchema, body));
  }

  @Post(':id/receipts/:movementId/reverse')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: z.toJSONSchema(reverseReceiptSchema, { io: 'input' }) as Record<string, unknown> })
  reverse(@Req() req: RequestContext, @Param('id') id: string, @Param('movementId') movementId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    const input = parseInput(reverseReceiptSchema, body);
    return this.payments.reverse(req.companyId!, parseInput(saleIdSchema, id), parseInput(saleIdSchema, movementId), req.userId!, parseInput(idempotencyKeySchema, key), input.reason);
  }

  @Post(':id/cancel')
  @ApiBody({ schema: z.toJSONSchema(cancelSaleSchema, { io: 'input' }) as Record<string, unknown> })
  cancel(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    const input = parseInput(cancelSaleSchema, body);
    return this.service.cancel(req.companyId!, parseInput(saleIdSchema, id), req.userId!, input.expectedVersion, input.reason);
  }

  @Get(':id/history')
  history(@Req() req: RequestContext, @Param('id') id: string) { return this.service.history(req.companyId!, parseInput(saleIdSchema, id)); }
}
