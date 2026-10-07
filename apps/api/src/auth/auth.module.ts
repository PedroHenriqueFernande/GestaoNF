import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessGuard, CompanyGuard } from './access.guard.js';

@Module({ controllers: [AuthController], providers: [AuthService, AccessGuard, CompanyGuard], exports: [AuthService, AccessGuard, CompanyGuard] })
export class AuthModule {}
