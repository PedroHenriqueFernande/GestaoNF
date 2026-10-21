import { BadRequestException, Controller, Delete, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { CertificateService } from './certificate.service.js';

@ApiTags('Fiscal - certificado')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('fiscal/certificate')
export class CertificateController {
  constructor(@Inject(CertificateService) private readonly certificates: CertificateService) {}

  @Get()
  get(@Req() req: RequestContext) { return this.certificates.view(req.companyId!); }

  @Post()
  async upload(@Req() req: RequestContext & FastifyRequest) {
    if (!req.isMultipart()) throw new BadRequestException('Envie arquivo PFX/P12 e senha em multipart/form-data.');
    let pfx: Buffer | undefined;
    let passphrase: string | undefined;
    try {
      for await (const part of req.parts({ limits: { fileSize: 2 * 1024 * 1024, fieldSize: 1024, files: 1, fields: 1, parts: 2 } })) {
        if (part.type === 'file') {
          if (part.fieldname !== 'file' || !/\.(pfx|p12)$/i.test(part.filename)) throw new BadRequestException('Selecione um arquivo .pfx ou .p12.');
          pfx = await part.toBuffer();
        } else if (part.fieldname === 'passphrase' && typeof part.value === 'string') {
          passphrase = part.value;
        } else throw new BadRequestException('Campos inesperados no envio do certificado.');
      }
      if (!pfx || !passphrase) throw new BadRequestException('Selecione o certificado e informe sua senha.');
      return await this.certificates.install(req.companyId!, req.userId!, pfx, passphrase);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof Error && /file.*large|limit/i.test(error.message)) throw new BadRequestException('O certificado deve ter até 2 MB.');
      throw error;
    } finally { pfx?.fill(0); }
  }

  @Delete()
  async disable(@Req() req: RequestContext) {
    await this.certificates.disable(req.companyId!, req.userId!);
    return { disabled: true };
  }
}
