import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { EmailsModule } from '../emails/emails.module.js';
import { UsersService } from './users.service.js';
import { InvitationThrottleService } from './invitation-throttle.service.js';
import { InvitationAcceptanceController, UsersController } from './users.controller.js';
@Module({ imports: [AuthModule, AccountsModule, EmailsModule], controllers: [UsersController, InvitationAcceptanceController], providers: [UsersService, InvitationThrottleService], exports: [UsersService] })
export class UsersModule {}
