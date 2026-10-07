import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import {
  createServiceSchema, listServicesSchema, municipalityIbgeCodeSchema, serviceIdSchema,
  updateServiceSchema, upsertMunicipalTaxCodeSchema,
} from './services.schemas.js';
import { ServicesService } from './services.service.js';

@ApiTags('Serviços')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true, description: 'Empresa ativa obtida em GET /companies' })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('services')
export class ServicesController {
  constructor(@Inject(ServicesService) private readonly services: ServicesService) {}

  @Post()
  @ApiOperation({ summary: 'Cadastra serviço; classificação fiscal é opcional no cadastro' })
  @ApiBody({ schema: z.toJSONSchema(createServiceSchema, { io: 'input' }) as Record<string, unknown> })
  create(@Req() request: RequestContext, @Body() body: unknown) {
    return this.services.create(request.companyId!, request.userId!, parseInput(createServiceSchema, body));
  }

  @Get()
  @ApiOperation({ summary: 'Lista serviços da empresa com busca, situação e paginação' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: '1 a 100; padrão 20' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Padrão 0' })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE', 'ALL'], description: 'Padrão ACTIVE' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Nome, código interno ou cTribNac' })
  list(@Req() request: RequestContext, @Query() query: unknown) {
    return this.services.list(request.companyId!, parseInput(listServicesSchema, query));
  }

  @Get(':id')
  get(@Req() request: RequestContext, @Param('id') id: string) {
    return this.services.get(request.companyId!, parseInput(serviceIdSchema, id));
  }

  @Patch(':id')
  @ApiBody({ schema: z.toJSONSchema(updateServiceSchema, { io: 'input' }) as Record<string, unknown> })
  update(@Req() request: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.services.update(request.companyId!, parseInput(serviceIdSchema, id), parseInput(updateServiceSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Inativa o serviço sem apagar histórico' })
  remove(@Req() request: RequestContext, @Param('id') id: string) {
    return this.services.remove(request.companyId!, parseInput(serviceIdSchema, id));
  }

  @Get(':id/municipal-tax-codes')
  @ApiOperation({ summary: 'Lista os códigos tributários municipais do serviço' })
  listMunicipalTaxCodes(@Req() request: RequestContext, @Param('id') id: string) {
    return this.services.listMunicipalTaxCodes(request.companyId!, parseInput(serviceIdSchema, id));
  }

  @Put(':id/municipal-tax-codes/:municipalityIbgeCode')
  @ApiOperation({ summary: 'Cria ou atualiza o código tributário do serviço neste município' })
  @ApiBody({ schema: z.toJSONSchema(upsertMunicipalTaxCodeSchema, { io: 'input' }) as Record<string, unknown> })
  upsertMunicipalTaxCode(
    @Req() request: RequestContext, @Param('id') id: string,
    @Param('municipalityIbgeCode') municipalityIbgeCode: string, @Body() body: unknown,
  ) {
    const input = parseInput(upsertMunicipalTaxCodeSchema, body);
    return this.services.upsertMunicipalTaxCode(
      request.companyId!, parseInput(serviceIdSchema, id),
      parseInput(municipalityIbgeCodeSchema, municipalityIbgeCode), input.municipalTaxCode,
    );
  }

  @Delete(':id/municipal-tax-codes/:municipalityIbgeCode')
  @HttpCode(204)
  removeMunicipalTaxCode(
    @Req() request: RequestContext, @Param('id') id: string,
    @Param('municipalityIbgeCode') municipalityIbgeCode: string,
  ) {
    return this.services.removeMunicipalTaxCode(
      request.companyId!, parseInput(serviceIdSchema, id),
      parseInput(municipalityIbgeCodeSchema, municipalityIbgeCode),
    );
  }
}
