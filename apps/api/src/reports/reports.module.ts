import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsReadService } from './reports-read.service.js';
import { ReportsCsvService } from './reports-csv.service.js';
@Module({imports:[AuthModule,CrmModule],controllers:[ReportsController],providers:[ReportsReadService,ReportsCsvService],exports:[ReportsReadService]})
export class ReportsModule {}
