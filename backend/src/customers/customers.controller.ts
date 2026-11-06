import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { CustomersService } from './customers.service.js';
import { createCustomerSchema, customerIdSchema, listCustomersSchema, updateCustomerSchema } from './customers.schemas.js';

@ApiTags('Clientes')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true, description: 'Empresa ativa obtida em GET /companies' })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('customers')
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastra cliente; CPF/CNPJ é opcional' })
  @ApiBody({ schema: z.toJSONSchema(createCustomerSchema, { io: 'input' }) as Record<string, unknown> })
  create(@Req() request: RequestContext, @Body() body: unknown) {
    return this.customers.create(request.companyId!, request.userId!, parseInput(createCustomerSchema, body));
  }

  @Get()
  @ApiOperation({ summary: 'Lista clientes da empresa com paginação' })
  list(@Req() request: RequestContext, @Query() query: unknown) {
    return this.customers.list(request.companyId!, parseInput(listCustomersSchema, query));
  }

  @Get(':id')
  get(@Req() request: RequestContext, @Param('id') id: string) {
    return this.customers.get(request.companyId!, parseInput(customerIdSchema, id));
  }

  @Patch(':id')
  @ApiBody({ schema: z.toJSONSchema(updateCustomerSchema, { io: 'input' }) as Record<string, unknown> })
  update(@Req() request: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(request.companyId!, parseInput(customerIdSchema, id), parseInput(updateCustomerSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() request: RequestContext, @Param('id') id: string) {
    return this.customers.remove(request.companyId!, parseInput(customerIdSchema, id));
  }
}
