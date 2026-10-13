import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { R2StorageService } from '../src/files/r2-storage.service.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
let storage: R2StorageService | undefined;
let probeKey: string | undefined;
async function check() {
  storage = new R2StorageService();
  if (!storage.config) throw new Error('R2_DISABLED');
  const bucket = storage.config.bucket;
  probeKey = `checks/${randomUUID()}/probe.txt`;
  const expected = Buffer.from('GestaoNF R2 connection test');
  await storage.put(bucket, probeKey, expected, 'text/plain', 'probe.txt');
  const head = await storage.head(bucket, probeKey);
  if (head.sizeBytes !== expected.length || !head.etag) throw new Error('R2_METADATA_MISMATCH');
  const result = await storage.read(bucket, probeKey, head.etag, expected.length);
  if (!result.body.equals(expected)) throw new Error('R2_CONTENT_MISMATCH');
  const url = await storage.signDownload(bucket, probeKey, 'probe.txt', 'text/plain', true, 60);
  const download = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(expected)) throw new Error('R2_SIGNED_DOWNLOAD_FAILED');
  await storage.remove(bucket, probeKey); probeKey = undefined;
  console.log('R2 conectado: gravação, leitura, download assinado e exclusão confirmados.');
}
check().catch(error => {
  // Never print credentials, SDK error bodies, or signed URLs.
  console.error(`Teste R2 falhou (${error instanceof Error ? error.name : 'Unknown'}). Confira R2_ENABLED, credenciais, endpoint, nome do bucket e permissão Object Read & Write. Consulte apps/api/src/files/README.md.`);
  process.exitCode = 1;
}).finally(async () => {
  if (probeKey && storage?.config) await storage.remove(storage.config.bucket, probeKey).catch(() => console.error('Não foi possível remover o objeto checks/ de teste; remova-o no painel R2.'));
  storage?.onModuleDestroy();
});
