import { Controller, Get, Inject, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseModule, DatabaseService } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompaniesController } from './companies/companies.controller.js';
import { CustomersModule } from './customers/customers.module.js';

@Controller('health')
class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get()
  async check() {
    await this.database.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}

@Module({ imports: [DatabaseModule, AuthModule, CustomersModule], controllers: [CompaniesController, HealthController] })
export class AppModule {}
