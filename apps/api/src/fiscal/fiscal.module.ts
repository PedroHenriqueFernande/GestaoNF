import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FiscalController } from './fiscal.controller.js';
import { FiscalService } from './fiscal.service.js';
import { CertificateController } from './certificate.controller.js';
import { CertificateService } from './certificate.service.js';

@Module({ imports: [AuthModule], controllers: [FiscalController, CertificateController], providers: [FiscalService, CertificateService], exports: [FiscalService, CertificateService] })
export class FiscalModule {}
