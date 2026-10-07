import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SalesController } from './sales.controller.js';
import { SalesPaymentsService } from './sales-payments.service.js';
import { SalesService } from './sales.service.js';

@Module({ imports: [AuthModule], controllers: [SalesController], providers: [SalesService, SalesPaymentsService] })
export class SalesModule {}
