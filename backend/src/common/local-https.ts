import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerOptions } from 'node:https';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));

export function localHttpsOptions(): ServerOptions | undefined {
  if (process.env.LOCAL_HTTPS_ENABLED !== 'true') return undefined;
  try {
    return {
      cert: readFileSync(resolve(workspaceRoot, process.env.LOCAL_HTTPS_CERT_FILE || '.certs/localhost.pem')),
      key: readFileSync(resolve(workspaceRoot, process.env.LOCAL_HTTPS_KEY_FILE || '.certs/localhost-key.pem')),
      minVersion: 'TLSv1.2',
    };
  } catch {
    throw new Error('Certificado HTTPS local indisponível. Execute npm run https:setup antes de iniciar a API.');
  }
}
