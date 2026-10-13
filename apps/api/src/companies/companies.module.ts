import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';

@Module({ imports: [AuthModule, AccountsModule], controllers: [CompaniesController], providers: [CompaniesService] })
export class CompaniesModule {}
