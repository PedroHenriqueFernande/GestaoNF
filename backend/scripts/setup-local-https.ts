import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const certificateDir = join(workspaceRoot, '.certs');
// The CA signing key stays outside the project and is never mounted into containers.
const authorityDir = join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'GestaoNF', 'https-ca');
const caCertPath = join(authorityDir, 'root-ca.pem');
const caKeyPath = join(authorityDir, 'root-ca-key.pem');
const leafCertPath = join(certificateDir, 'localhost.pem');
const leafKeyPath = join(certificateDir, 'localhost-key.pem');
const rootCopyPath = join(certificateDir, 'root-ca.pem');

function serial() { return `01${randomBytes(15).toString('hex')}`; }
function validity(years: number) {
  const notBefore = new Date(Date.now() - 5 * 60000);
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + years);
  return { notBefore, notAfter };
}

async function prepare() {
  await mkdir(authorityDir, { recursive: true, mode: 0o700 });
  await mkdir(certificateDir, { recursive: true, mode: 0o700 });
  if (existsSync(caCertPath) !== existsSync(caKeyPath)) throw new Error('A autoridade HTTPS local está incompleta. Confira a pasta de certificados do usuário.');
  if (!existsSync(caCertPath)) {
    const keys = forge.pki.rsa.generateKeyPair(3072);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = serial();
    Object.assign(cert.validity, validity(5));
    const name = [{ name: 'commonName', value: 'GestaoNF Local Development CA' }, { name: 'organizationName', value: 'GestaoNF Development' }];
    cert.setSubject(name);
    cert.setIssuer(name);
    cert.setExtensions([{ name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 0 }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    await writeFile(caKeyPath, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
    await writeFile(caCertPath, forge.pki.certificateToPem(cert), { mode: 0o600 });
  }
  const caPem = await readFile(caCertPath, 'utf8');
  const caKey = await readFile(caKeyPath, 'utf8');
  const caX509 = new X509Certificate(caPem);
  if (!caX509.ca || !caX509.checkPrivateKey(createPrivateKey(caKey)) || Date.parse(caX509.validTo) < Date.now() + 30 * 86400000) throw new Error('A autoridade HTTPS local precisa ser renovada antes de gerar o certificado.');
  let reuse = false;
  if (existsSync(leafCertPath) && existsSync(leafKeyPath)) {
    try {
      const leaf = new X509Certificate(await readFile(leafCertPath));
      reuse = leaf.verify(caX509.publicKey) && leaf.checkPrivateKey(createPrivateKey(await readFile(leafKeyPath))) && !!leaf.checkHost('localhost') && !!leaf.checkIP('127.0.0.1') && !!leaf.checkIP('::1') && Date.parse(leaf.validTo) > Date.now() + 30 * 86400000;
    } catch { reuse = false; }
  }
  if (!reuse) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = serial();
    Object.assign(cert.validity, validity(1));
    cert.setSubject([{ name: 'commonName', value: 'localhost' }, { name: 'organizationName', value: 'GestaoNF Local Development' }]);
    cert.setIssuer(forge.pki.certificateFromPem(caPem).subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, { type: 7, ip: '::1' }] },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(forge.pki.privateKeyFromPem(caKey), forge.md.sha256.create());
    await writeFile(leafKeyPath, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 });
    await writeFile(leafCertPath, forge.pki.certificateToPem(cert), { mode: 0o600 });
  }
  await writeFile(rootCopyPath, caPem, { mode: 0o600 });

  if (process.platform === 'win32' && !process.argv.includes('--no-trust')) {
    const trust = spawnSync('certutil.exe', ['-user', '-addstore', 'Root', rootCopyPath], { windowsHide: true, stdio: 'pipe' });
    if (trust.status !== 0) throw new Error('Não foi possível confiar na autoridade local do Windows. Importe .certs/root-ca.pem em Autoridades Raiz Confiáveis do usuário atual.');
    console.log('Certificado HTTPS local confiável instalado para o usuário atual do Windows.');
  } else console.log('Importe .certs/root-ca.pem no repositório de autoridades confiáveis do seu sistema/navegador.');

  const envPath = join(workspaceRoot, '.env');
  let env = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  for (const [key, value] of Object.entries({ LOCAL_HTTPS_ENABLED: 'true', LOCAL_HTTPS_CERT_FILE: '.certs/localhost.pem', LOCAL_HTTPS_KEY_FILE: '.certs/localhost-key.pem', API_ORIGIN: 'https://localhost:4030', WEB_ORIGIN: 'https://localhost:3001' })) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
  }
  // Follow the current browser hostname rather than force localhost for 127.0.0.1 sessions.
  env = env.replace(/^VITE_API_URL=["']?https?:\/\/(?:localhost|127\.0\.0\.1):(?:3000|4030)\/?["']?\r?\n?/gm, '');
  await writeFile(envPath, env, { mode: 0o600 });
  console.log('HTTPS configurado: https://localhost:3001 e https://localhost:4030. Reinicie frontend e API.');
}

prepare().catch(error => { console.error(error instanceof Error ? error.message : 'Não foi possível preparar o HTTPS local.'); process.exitCode = 1; });
