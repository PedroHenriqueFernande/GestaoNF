import { Body, Controller, Get, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { CompaniesService } from './companies.service.js';
import { createCompanySchema, updateCompanySchema } from './companies.schemas.js';

@ApiTags('Empresas')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('companies')
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}
  @Get()
  list(@Req() request: RequestContext) { return this.companies.list(request.userId!); }

  @Post()
  @ApiOperation({ summary: 'Cria empresa e vincula o usuário como proprietário' })
  @ApiBody({ schema: z.toJSONSchema(createCompanySchema, { io: 'input' }) as Record<string, unknown> })
  create(@Req() request: RequestContext, @Body() body: unknown) {
    return this.companies.create(request.userId!, parseInput(createCompanySchema, body));
  }

  @Get('current')
  @UseGuards(CompanyGuard)
  @ApiHeader({ name: 'X-Company-Id', required: true })
  get(@Req() request: RequestContext) { return this.companies.get(request.companyId!, request.userId!); }

  @Patch('current')
  @UseGuards(CompanyGuard)
  @ApiHeader({ name: 'X-Company-Id', required: true })
  @ApiBody({ schema: z.toJSONSchema(updateCompanySchema, { io: 'input' }) as Record<string, unknown> })
  update(@Req() request: RequestContext, @Body() body: unknown) {
    return this.companies.update(request.companyId!, request.userId!, parseInput(updateCompanySchema, body));
  }
}
