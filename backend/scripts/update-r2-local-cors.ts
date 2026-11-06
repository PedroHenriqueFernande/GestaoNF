import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { GetBucketCorsCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { R2StorageService } from '../src/files/r2-storage.service.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const origins = ['https://localhost:3001', 'https://127.0.0.1:3001'];
const storage = new R2StorageService();
async function update() {
  if (!storage.config) { console.log('R2 desabilitado: nenhuma configuração de bucket alterada.'); return; }
  const client = storage.requireClient();
  const bucket = storage.config.bucket;
  let rules;
  try { rules = (await client.send(new GetBucketCorsCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(15000) })).CORSRules ?? []; }
  catch (error) { if (error instanceof Error && error.name === 'NoSuchCORSConfiguration') rules = []; else throw error; }
  const pending = origins.filter(origin => !rules.some(rule => (rule.AllowedOrigins?.includes(origin) || rule.AllowedOrigins?.includes('*')) && rule.AllowedMethods?.includes('PUT')));
  if (!pending.length) { console.log('O CORS do R2 já aceita uploads das origens HTTPS locais.'); return; }
  if (!process.argv.includes('--apply')) { console.log('O CORS do R2 precisa das origens HTTPS locais. Execute novamente com --apply para adicioná-las.'); return; }
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [...rules, { AllowedOrigins: pending, AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['content-type', 'cache-control'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }] } }), { abortSignal: AbortSignal.timeout(15000) });
  const confirmed = await client.send(new GetBucketCorsCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(15000) });
  if (!origins.every(origin => confirmed.CORSRules?.some(rule => (rule.AllowedOrigins?.includes(origin) || rule.AllowedOrigins?.includes('*')) && rule.AllowedMethods?.includes('PUT')))) throw new Error('CORS_NOT_CONFIRMED');
  console.log('CORS do R2 atualizado e conferido para localhost/127.0.0.1 em HTTPS. Regras anteriores preservadas.');
}
update().catch(error => { console.error(`Não foi possível conferir/atualizar o CORS do R2 (${error instanceof Error ? error.name : 'Unknown'}). Configure as origens HTTPS no painel do bucket.`); process.exitCode = 1; }).finally(() => storage.onModuleDestroy());
