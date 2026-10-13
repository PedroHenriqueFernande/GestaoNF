import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SalesController } from './sales.controller.js';
import { SalesPaymentsService } from './sales-payments.service.js';
import { SalesService } from './sales.service.js';
import { FilesModule } from '../files/files.module.js';

@Module({ imports: [AuthModule, FilesModule], controllers: [SalesController], providers: [SalesService, SalesPaymentsService], exports: [SalesService] })
export class SalesModule {}
