import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsReadService } from './reports-read.service.js';
import { ReportsCsvService } from './reports-csv.service.js';
import { ReportsPdfService } from './reports-pdf.service.js';
@Module({imports:[AuthModule,CrmModule],controllers:[ReportsController],providers:[ReportsReadService,ReportsCsvService,ReportsPdfService],exports:[ReportsReadService]})
export class ReportsModule {}
