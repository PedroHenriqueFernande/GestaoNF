import { Controller, Get, Inject, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AccessGuard, CompanyGuard, routeEntry, type RequestContext } from '../auth/access.guard.js';
import { RequireAnyPermission, RequirePermission } from '../permissions/permission.decorators.js';
import { parseInput } from '../common/validate.js';
import { ReportsReadService } from './reports-read.service.js';
import { ReportsCsvService } from './reports-csv.service.js';
import { ReportsPdfService } from './reports-pdf.service.js';
import { reportFiltersSchema, reportOptionsSchema, reportTypeSchema } from './reports.schemas.js';
@ApiTags('Relatórios')
@ApiBearerAuth()
@ApiHeader({name:'X-Company-Id',required:true})
@UseGuards(AccessGuard,CompanyGuard)
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsReadService) private readonly reader:ReportsReadService,@Inject(ReportsCsvService) private readonly csv:ReportsCsvService,@Inject(ReportsPdfService) private readonly pdf:ReportsPdfService) {}
  @Get('options')
  @RequirePermission('reports.access')
  options(@Req() r:RequestContext,@Query() query:unknown){ return this.reader.options(r.actor!,parseInput(reportOptionsSchema,query),routeEntry(r)); }
  @Get('customers.csv')
  @RequirePermission('customers.export')
  @ApiOperation({summary:'Exporta todos os clientes filtrados, até 50 mil registros'})
  async customersCsv(@Req() r:RequestContext,@Query() query:unknown,@Res() reply:FastifyReply) {
    const stream=await this.csv.create(r.actor!,'customers',parseInput(reportFiltersSchema,query),routeEntry(r));
    return reply.header('Content-Type','text/csv; charset=utf-8').header('Cache-Control','private, no-store').header('Content-Disposition','attachment; filename="clientes.csv"').send(stream);
  }
  @Get('service-catalog.csv')
  @RequirePermission('reports.export')
  async servicesCsv(@Req() r:RequestContext,@Query() query:unknown,@Res() reply:FastifyReply) {
    const stream=await this.csv.create(r.actor!,'service-catalog',parseInput(reportFiltersSchema,query),routeEntry(r));
    return reply.header('Content-Type','text/csv; charset=utf-8').header('Cache-Control','private, no-store').header('Content-Disposition','attachment; filename="servicos.csv"').send(stream);
  }
  @Get(':type/pdf')
  @RequireAnyPermission(['reports.export', 'customers.export'])
  @ApiOperation({summary:'Gera o PDF do relatório com todos os registros filtrados'})
  async pdfReport(@Req() r:RequestContext,@Param('type') type:unknown,@Query() query:unknown,@Res() reply:FastifyReply) {
    const file=await this.pdf.create(r.actor!,parseInput(reportTypeSchema,type),parseInput(reportFiltersSchema,query),routeEntry(r));
    return reply.header('Content-Type','application/pdf').header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename="${file.filename}"`).send(file.buffer);
  }
  @Get(':type')
  @RequirePermission('reports.access')
  @ApiQuery({name:'from',required:false,type:String}) @ApiQuery({name:'to',required:false,type:String})
  @ApiQuery({name:'cursor',required:false,type:String}) @ApiQuery({name:'limit',required:false,type:Number})
  @ApiOperation({summary:'Consulta relatório com resumo de todos os registros filtrados e página de detalhes'})
  read(@Req() r:RequestContext,@Param('type') type:unknown,@Query() query:unknown,@Res({passthrough:true}) reply:FastifyReply){
    reply.header('Cache-Control','private, no-store');
    return this.reader.read(r.actor!,parseInput(reportTypeSchema,type),parseInput(reportFiltersSchema,query),routeEntry(r));
  }
}
