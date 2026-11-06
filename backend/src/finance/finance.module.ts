import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FinanceController } from './finance.controller.js';
import { FinanceDatesService } from './finance-dates.service.js';
import { FinanceReadService } from './finance-read.service.js';

@Module({ imports: [AuthModule], controllers: [FinanceController], providers: [FinanceReadService, FinanceDatesService] })
export class FinanceModule {}
