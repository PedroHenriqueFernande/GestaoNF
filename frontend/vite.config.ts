import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, workspaceRoot, '');
  let https;
  if (command === 'serve' && env.LOCAL_HTTPS_ENABLED === 'true') {
    try {
      https = {
        cert: readFileSync(resolve(workspaceRoot, env.LOCAL_HTTPS_CERT_FILE || '.certs/localhost.pem')),
        key: readFileSync(resolve(workspaceRoot, env.LOCAL_HTTPS_KEY_FILE || '.certs/localhost-key.pem')),
      };
    } catch { throw new Error('Certificado HTTPS local indisponível. Execute npm run https:setup.'); }
  }
  return {
    envDir: workspaceRoot,
    plugins: [react()],
    server: { host: '0.0.0.0', port: 3001, strictPort: true, https },
    preview: { host: '0.0.0.0', port: 3001, strictPort: true, https },
  };
});
