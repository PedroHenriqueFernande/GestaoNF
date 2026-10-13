import 'reflect-metadata';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { OutboxDispatcherService } from './jobs/outbox-dispatcher.service.js';
import { WhatsAppWorkersService } from './jobs/whatsapp-workers.service.js';
import { WorkerModule } from './jobs/worker.module.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL não configurada');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
  const dispatcher = app.get(OutboxDispatcherService);
  const workers = app.get(WhatsAppWorkersService);
  const abort = new AbortController();
  workers.start();
  const shutdown = async () => {
    abort.abort();
    await Promise.all([dispatcher.close(), workers.close()]);
    await app.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await dispatcher.run(abort.signal);
}

bootstrap().catch((error) => { console.error(error); process.exitCode = 1; });
