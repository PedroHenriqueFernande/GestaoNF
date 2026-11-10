import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FilesModule } from '../files/files.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({ imports: [AuthModule, FilesModule], controllers: [ProfileController], providers: [ProfileService], exports: [ProfileService] })
export class ProfileModule {}
