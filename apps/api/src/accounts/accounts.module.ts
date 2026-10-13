import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsService } from './accounts.service.js';
import { AccountsController } from './accounts.controller.js';
@Module({ imports: [AuthModule], providers: [AccountsService], controllers: [AccountsController], exports: [AccountsService] })
export class AccountsModule {}
