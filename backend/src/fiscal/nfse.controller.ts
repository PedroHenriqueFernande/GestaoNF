import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { NfsePreviewService } from './nfse-preview.service.js';
import { NfseIssuanceService } from './nfse-issuance.service.js';
import { nfseEmitSchema, nfseIdSchema, nfsePreviewSchema } from './nfse.schemas.js';
import { nfsePreviewPdf } from './nfse-pdf.js';

@ApiTags('NFS-e nacional')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller()
export class NfseController {
  constructor(@Inject(NfsePreviewService) private readonly previews: NfsePreviewService, @Inject(NfseIssuanceService) private readonly issuance: NfseIssuanceService) {}

  @Post('sales/:saleId/nfse/preview')
  preview(@Req() req: RequestContext, @Param('saleId') saleId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.previews.create(req.companyId!, req.userId!, parseInput(nfseIdSchema, saleId), parseInput(nfseIdSchema, key), parseInput(nfsePreviewSchema, body));
  }

  @Get('fiscal/nfse/previews/:id')
  getPreview(@Req() req: RequestContext, @Param('id') id: string) { return this.previews.get(req.companyId!, parseInput(nfseIdSchema, id)); }

  @Get('fiscal/nfse/previews/:id/pdf')
  async pdf(@Req() req: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    const preview = await this.previews.get(req.companyId!, parseInput(nfseIdSchema, id));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="previa-nfse-${preview.orderCode}.pdf"`).header('Cache-Control', 'private, no-store').send(await nfsePreviewPdf(preview));
  }

  @Post('sales/:saleId/nfse/emissions')
  @HttpCode(202)
  emit(@Req() req: RequestContext, @Param('saleId') saleId: string, @Headers('idempotency-key') key: string, @Body() body: unknown) {
    return this.issuance.emit(req.companyId!, req.userId!, parseInput(nfseIdSchema, saleId), parseInput(nfseEmitSchema, body).previewId, parseInput(nfseIdSchema, key));
  }

  @Get('sales/:saleId/nfse/emissions')
  forSale(@Req() req: RequestContext, @Param('saleId') saleId: string) { return this.issuance.forSale(req.companyId!, parseInput(nfseIdSchema, saleId)); }

  @Get('fiscal/nfse/emissions/:id')
  emission(@Req() req: RequestContext, @Param('id') id: string) { return this.issuance.get(req.companyId!, parseInput(nfseIdSchema, id)); }

  @Post('fiscal/nfse/dps/:id/reconcile')
  @HttpCode(202)
  reconcile(@Req() req: RequestContext, @Param('id') id: string) { return this.issuance.resume(req.companyId!, req.userId!, parseInput(nfseIdSchema, id)); }

  @Get('fiscal/nfse/documents/:id/xml')
  async xml(@Req() req: RequestContext, @Param('id') id: string, @Res() reply: FastifyReply) {
    const document = await this.issuance.document(req.companyId!, parseInput(nfseIdSchema, id));
    return reply.header('Content-Type', 'application/xml; charset=utf-8').header('Content-Disposition', `attachment; filename="nfse-${document.number.replace(/[^0-9A-Za-z-]/g, '')}.xml"`).header('Cache-Control', 'private, no-store').send(document.officialXml);
  }
}
