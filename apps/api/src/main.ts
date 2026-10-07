import 'reflect-metadata';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import { AppModule } from './app.module.js';
import { allowedWebOrigins } from './common/origins.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

async function bootstrap() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres');
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));
  await app.register(cookie);
  app.enableCors({
    origin: allowedWebOrigins(),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('GestãoNF API').setVersion('0.1.0').setOpenAPIVersion('3.1.0')
    .addBearerAuth().addCookieAuth('access_token').build());
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
  await app.listen(Number(process.env.API_PORT ?? '3000'), '0.0.0.0');
}

bootstrap().catch((error) => { console.error(error); process.exitCode = 1; });
