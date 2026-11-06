import { readFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

const secure = process.env.LOCAL_HTTPS_ENABLED === 'true';
const port = process.env.API_PORT || '4030';
try {
  const get = secure ? httpsGet : httpGet;
  const options = secure ? { ca: readFileSync(process.env.LOCAL_HTTPS_CA_FILE || '/etc/gestaonf/https/root-ca.pem') } : {};
  const req = get(`${secure ? 'https' : 'http'}://127.0.0.1:${port}/health`, options, response => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  });
  req.setTimeout(3000, () => req.destroy(new Error('Healthcheck timeout')));
  req.on('error', () => { process.exitCode = 1; });
} catch { process.exitCode = 1; }
