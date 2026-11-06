import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { ReportsReadService } from './reports-read.service.js';
import { ReportsCsvService } from './reports-csv.service.js';
import { reportFiltersSchema, reportOptionsSchema, reportTypeSchema } from './reports.schemas.js';
const ctx=(r:RequestContext)=>({companyId:r.companyId!,userId:r.userId!});
@ApiTags('Relatórios')
@ApiBearerAuth()
@ApiHeader({name:'X-Company-Id',required:true})
@UseGuards(AccessGuard,CompanyGuard)
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsReadService) private readonly reader:ReportsReadService,@Inject(ReportsCsvService) private readonly csv:ReportsCsvService) {}
  @Get('options')
  options(@Req() r:RequestContext,@Query() query:unknown){ return this.reader.options(ctx(r),parseInput(reportOptionsSchema,query)); }
  @Get('customers.csv')
  @ApiOperation({summary:'Exporta todos os clientes filtrados, até 50 mil registros'})
  async customersCsv(@Req() r:RequestContext,@Query() query:unknown,@Res() reply:FastifyReply) {
    const stream=await this.csv.create(ctx(r),'customers',parseInput(reportFiltersSchema,query));
    return reply.header('Content-Type','text/csv; charset=utf-8').header('Cache-Control','private, no-store').header('Content-Disposition','attachment; filename="clientes.csv"').send(stream);
  }
  @Get('service-catalog.csv')
  async servicesCsv(@Req() r:RequestContext,@Query() query:unknown,@Res() reply:FastifyReply) {
    const stream=await this.csv.create(ctx(r),'service-catalog',parseInput(reportFiltersSchema,query));
    return reply.header('Content-Type','text/csv; charset=utf-8').header('Cache-Control','private, no-store').header('Content-Disposition','attachment; filename="servicos.csv"').send(stream);
  }
  @Get(':type')
  @ApiQuery({name:'from',required:false,type:String}) @ApiQuery({name:'to',required:false,type:String})
  @ApiQuery({name:'cursor',required:false,type:String}) @ApiQuery({name:'limit',required:false,type:Number})
  @ApiOperation({summary:'Consulta relatório com resumo de todos os registros filtrados e página de detalhes'})
  read(@Req() r:RequestContext,@Param('type') type:unknown,@Query() query:unknown,@Res({passthrough:true}) reply:FastifyReply){
    reply.header('Cache-Control','private, no-store');
    return this.reader.read(ctx(r),parseInput(reportTypeSchema,type),parseInput(reportFiltersSchema,query));
  }
}
