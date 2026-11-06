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
import { NfseEventProcessorService } from './nfse-event-processor.service.js';
import { NfseDocumentActionsService } from './nfse-document-actions.service.js';
import { NfseReadinessService } from './nfse-readiness.service.js';

@Module({ imports: [AuthModule, FilesModule], controllers: [FiscalController, CertificateController, NfseController], providers: [FiscalService, CertificateService, NfsePreviewService, NfseIssuanceService, NationalNfseClient, NfseProcessorService, NfseEventProcessorService, NfseDocumentActionsService, NfseReadinessService], exports: [FiscalService, CertificateService, NfseProcessorService, NfseEventProcessorService] })
export class FiscalModule {}
