import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';

@Module({ imports: [AuthModule], controllers: [CompaniesController], providers: [CompaniesService] })
export class CompaniesModule {}
