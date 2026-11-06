import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { R2StorageService } from './r2-storage.service.js';

@Module({ imports: [AuthModule], controllers: [FilesController], providers: [FilesService, R2StorageService], exports: [FilesService, R2StorageService] })
export class FilesModule {}
