import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { FilesModule } from '../files/files.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { CompanyLogoController } from './company-logo.controller.js';
import { CompanyLogoService } from './company-logo.service.js';

@Module({ imports: [AuthModule, AccountsModule, FilesModule], controllers: [CompaniesController, CompanyLogoController], providers: [CompaniesService, CompanyLogoService], exports: [CompanyLogoService] })
export class CompaniesModule {}
