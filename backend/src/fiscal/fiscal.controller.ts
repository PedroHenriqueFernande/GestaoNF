import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { RequireAnyPermission, RequirePermission } from '../permissions/permission.decorators.js';
import { parseInput } from '../common/validate.js';
import { FiscalService } from './fiscal.service.js';
import { addTaxRevisionSchema, advanceSeriesSchema, createSeriesSchema, createTaxProfileSchema, fiscalIdSchema, previewTaxSchema, seriesQuerySchema, updateSeriesSchema, updateTaxProfileSchema } from './fiscal.schemas.js';

@ApiTags('Fiscal')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('fiscal')
export class FiscalController {
  constructor(@Inject(FiscalService) private readonly fiscal: FiscalService) {}

  @Get('series')
  @RequireAnyPermission(['fiscal.series', 'sales.create'])
  listSeries(@Req() req: RequestContext, @Query() query: unknown) {
    return this.fiscal.listSeries(req.companyId!, parseInput(seriesQuerySchema, query).environment);
  }

  @Get('series/:id/adjustments')
  @RequirePermission('fiscal.series')
  listSeriesAdjustments(@Req() req: RequestContext, @Param('id') id: string) {
    return this.fiscal.listSeriesAdjustments(req.companyId!, parseInput(fiscalIdSchema, id));
  }

  @Post('series')
  @RequirePermission('fiscal.series')
  createSeries(@Req() req: RequestContext, @Body() body: unknown) {
    return this.fiscal.createSeries(req.companyId!, req.userId!, parseInput(createSeriesSchema, body));
  }

  @Patch('series/:id')
  @RequirePermission('fiscal.series')
  updateSeries(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.updateSeries(req.companyId!, req.userId!, parseInput(fiscalIdSchema, id), parseInput(updateSeriesSchema, body));
  }

  @Post('series/:id/advance')
  @RequirePermission('fiscal.series')
  advanceSeries(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.advanceSeries(req.companyId!, req.userId!, parseInput(fiscalIdSchema, id), parseInput(advanceSeriesSchema, body));
  }

  @Get('tax-profiles')
  @RequireAnyPermission(['fiscal.tax', 'sales.create'])
  listTaxProfiles(@Req() req: RequestContext) { return this.fiscal.listTaxProfiles(req.companyId!); }

  @Post('tax-profiles')
  @RequirePermission('fiscal.tax')
  createTaxProfile(@Req() req: RequestContext, @Body() body: unknown) {
    return this.fiscal.createTaxProfile(req.companyId!, req.userId!, parseInput(createTaxProfileSchema, body));
  }

  @Patch('tax-profiles/:id')
  @RequirePermission('fiscal.tax')
  updateTaxProfile(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.updateTaxProfile(req.companyId!, req.userId!, parseInput(fiscalIdSchema, id), parseInput(updateTaxProfileSchema, body));
  }

  @Post('tax-profiles/:id/revisions')
  @RequirePermission('fiscal.tax')
  addTaxRevision(@Req() req: RequestContext, @Param('id') id: string, @Body() body: unknown) {
    return this.fiscal.addTaxRevision(req.companyId!, req.userId!, parseInput(fiscalIdSchema, id), parseInput(addTaxRevisionSchema, body));
  }

  @Post('tax-profiles/preview')
  @RequireAnyPermission(['fiscal.tax', 'sales.create'])
  preview(@Req() req: RequestContext, @Body() body: unknown) {
    const input = parseInput(previewTaxSchema, body);
    return this.fiscal.previewTax(req.companyId!, input.items, input.competence, input.municipalityIbgeCode);
  }
}
