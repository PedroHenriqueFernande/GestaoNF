import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import * as schema from '@gestaonf/database/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly client = postgres(process.env.DATABASE_URL ?? '', { max: 10 });
  readonly db = drizzle(this.client, { schema });

  async onModuleDestroy() {
    await this.client.end();
  }
}

@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
