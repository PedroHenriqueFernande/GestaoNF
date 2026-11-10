import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

@Module({ imports: [AuthModule], controllers: [ServicesController], providers: [ServicesService], exports: [ServicesService] })
export class ServicesModule {}
