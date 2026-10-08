import { Controller, Get, Inject, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseModule, DatabaseService } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { ServicesModule } from './services/services.module.js';
import { SalesModule } from './sales/sales.module.js';
import { FinanceModule } from './finance/finance.module.js';

@Controller('health')
class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  @Get()
  async check() {
    await this.database.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}

@Module({ imports: [DatabaseModule, AuthModule, CompaniesModule, CustomersModule, ServicesModule, SalesModule, FinanceModule], controllers: [HealthController] })
export class AppModule {}
