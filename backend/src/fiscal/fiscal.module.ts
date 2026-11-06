import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FiscalController } from './fiscal.controller.js';
import { FiscalService } from './fiscal.service.js';
import { CertificateController } from './certificate.controller.js';
import { CertificateService } from './certificate.service.js';
import { FilesModule } from '../files/files.module.js';
import { NfseController } from './nfse.controller.js';
import { NfsePreviewService } from './nfse-preview.service.js';
import { NfseIssuanceService } from './nfse-issuance.service.js';
import { NationalNfseClient } from './nfse-national.client.js';
import { NfseProcessorService } from './nfse-processor.service.js';

@Module({ imports: [AuthModule, FilesModule], controllers: [FiscalController, CertificateController, NfseController], providers: [FiscalService, CertificateService, NfsePreviewService, NfseIssuanceService, NationalNfseClient, NfseProcessorService], exports: [FiscalService, CertificateService, NfseProcessorService] })
export class FiscalModule {}
