import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { companyFiscalCertificateEvents, companyFiscalCertificates, companies, companyUsers } from '@gestaonf/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import forge from 'node-forge';
import { DatabaseService } from '../database/database.module.js';

const MAX_PFX_BYTES = 2 * 1024 * 1024;
const CPF_OID = '2.16.76.1.3.1';
const CNPJ_OID = '2.16.76.1.3.3';

type CertificateView = {
  id: string; status: 'ACTIVE' | 'EXPIRED'; subjectTaxId: string; fingerprintSha256: string;
  serialNumber: string; subjectSummary: string; issuerSummary: string;
  notBefore: Date; notAfter: Date; createdAt: Date;
};

function findIdentity(cert: forge.pki.Certificate): { kind: 'PF' | 'PJ'; taxId: string } {
  const ext = cert.getExtension('subjectAltName') as { altNames?: Array<{ type: number; value: forge.asn1.Asn1[] }> } | undefined;
  const found: Array<{ kind: 'PF' | 'PJ'; taxId: string }> = [];
  for (const name of ext?.altNames ?? []) {
    if (name.type !== 0 || !Array.isArray(name.value)) continue;
    const oidNode = name.value.find((node) => node.type === forge.asn1.Type.OID);
    const valueNode = name.value.find((node) => node.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && node.type === 0);
    if (!oidNode || !valueNode || typeof oidNode.value !== 'string') continue;
    const kind = oidNode.value === forge.asn1.oidToDer(CPF_OID).getBytes() ? 'PF'
      : oidNode.value === forge.asn1.oidToDer(CNPJ_OID).getBytes() ? 'PJ' : null;
    if (!kind) continue;
    const inner = Array.isArray(valueNode.value) ? valueNode.value[0] : undefined;
    if (!inner || typeof inner.value !== 'string') continue;
    const digits = inner.value.replace(/\D/g, '');
    // ICP-Brasil otherName can include supplementary fields after the CPF/CNPJ.
    const taxId = digits.slice(0, kind === 'PF' ? 11 : 14);
    if (taxId.length === (kind === 'PF' ? 11 : 14)) found.push({ kind, taxId });
  }
  if (found.length !== 1) throw new UnprocessableEntityException('Não foi possível identificar um único CPF/CNPJ no certificado ICP-Brasil.');
  return found[0];
}

export function readPfx(pfx: Buffer, passphrase: string) {
  if (pfx.length === 0 || pfx.length > MAX_PFX_BYTES || pfx[0] !== 0x30) throw new BadRequestException('Envie um arquivo PFX/P12 de até 2 MB.');
  let store: forge.pkcs12.Pkcs12Pfx;
  try {
    store = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), true, passphrase);
  } catch {
    throw new BadRequestException('O arquivo PFX/P12 ou sua senha é inválido.');
  }
  const keyBags = [
    ...(store.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(store.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  if (keyBags.length !== 1 || !keyBags[0].key) throw new UnprocessableEntityException('O PFX deve conter uma chave privada A1 exportável.');
  let privateKey;
  try { privateKey = createPrivateKey(forge.pki.privateKeyToPem(keyBags[0].key)); }
  catch { throw new UnprocessableEntityException('Algoritmo de chave privada não suportado neste cadastro.'); }
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const certBags = store.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const matches = certBags.filter((bag) => {
    if (!bag.cert) return false;
    try {
      const cert = new X509Certificate(forge.pki.certificateToPem(bag.cert));
      return cert.publicKey.export({ format: 'der', type: 'spki' }).equals(publicDer);
    } catch { return false; }
  });
  if (matches.length !== 1 || !matches[0].cert) throw new UnprocessableEntityException('A chave privada não corresponde a um único certificado no PFX.');
  const parsed = matches[0].cert;
  const x509 = new X509Certificate(forge.pki.certificateToPem(parsed));
  const identity = findIdentity(parsed);
  const now = Date.now();
  if (Date.parse(x509.validFrom) > now || Date.parse(x509.validTo) <= now) throw new UnprocessableEntityException('O certificado está fora do prazo de validade.');
  if (x509.ca) throw new UnprocessableEntityException('Envie o certificado da empresa, não um certificado de autoridade certificadora.');
  const keyUsage = parsed.getExtension('keyUsage') as { digitalSignature?: boolean } | undefined;
  if (keyUsage && keyUsage.digitalSignature !== true) throw new UnprocessableEntityException('O certificado não permite assinatura digital.');
  const extendedUsage = parsed.getExtension('extKeyUsage') as { clientAuth?: boolean } | undefined;
  if (extendedUsage && !extendedUsage.clientAuth) throw new UnprocessableEntityException('O certificado não permite autenticação TLS de cliente.');
  try { createSecureContext({ pfx, passphrase }); }
  catch { throw new UnprocessableEntityException('O PFX não pode ser usado pelo servidor para conexão TLS.'); }
  return { identity, fingerprintSha256: x509.fingerprint256.replaceAll(':', '').toLowerCase(), serialNumber: x509.serialNumber,
    subjectSummary: x509.subject.slice(0, 500), issuerSummary: x509.issuer.slice(0, 500),
    notBefore: new Date(x509.validFrom), notAfter: new Date(x509.validTo) };
}

@Injectable()
export class CertificateService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private key() {
    const encoded = process.env.FISCAL_CERTIFICATE_ENCRYPTION_KEY ?? '';
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('Configure FISCAL_CERTIFICATE_ENCRYPTION_KEY no servidor.');
    return key;
  }

  private keyId() {
    const id = process.env.FISCAL_CERTIFICATE_ENCRYPTION_KEY_ID ?? 'v1';
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) throw new ServiceUnavailableException('Identificador da chave fiscal inválido.');
    return id;
  }

  private encrypt(companyId: string, id: string, pfx: Buffer, passphrase: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(`${companyId}:${id}:${this.keyId()}`));
    const payload = Buffer.from(JSON.stringify({ pfx: pfx.toString('base64'), passphrase }), 'utf8');
    try {
      const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
      return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
    } finally { payload.fill(0); }
  }

  async credential(companyId: string) {
    const [row] = await this.database.db.select().from(companyFiscalCertificates)
      .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).limit(1);
    if (!row || !row.encryptedPayload || row.notAfter <= new Date()) throw new NotFoundException('Certificado ativo e válido não encontrado.');
    const previous = JSON.parse(process.env.FISCAL_CERTIFICATE_PREVIOUS_KEYS || '{}') as Record<string, string>;
    const key = row.encryptionKeyId === this.keyId() ? this.key() : Buffer.from(previous[row.encryptionKeyId] ?? '', 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('Chave de criptografia do certificado indisponível.');
    const [iv, tag, data] = row.encryptedPayload.split('.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(`${companyId}:${row.id}:${row.encryptionKeyId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const raw = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
    try {
      const content = JSON.parse(raw.toString('utf8')) as { pfx: string; passphrase: string };
      return { certificateId: row.id, pfx: Buffer.from(content.pfx, 'base64'), passphrase: content.passphrase };
    } finally { raw.fill(0); }
  }

  async view(companyId: string): Promise<CertificateView | null> {
    const [row] = await this.database.db.select({ id: companyFiscalCertificates.id, subjectTaxId: companyFiscalCertificates.subjectTaxId,
      fingerprintSha256: companyFiscalCertificates.fingerprintSha256, serialNumber: companyFiscalCertificates.serialNumber,
      subjectSummary: companyFiscalCertificates.subjectSummary, issuerSummary: companyFiscalCertificates.issuerSummary,
      notBefore: companyFiscalCertificates.notBefore, notAfter: companyFiscalCertificates.notAfter, createdAt: companyFiscalCertificates.createdAt })
      .from(companyFiscalCertificates).where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).limit(1);
    return row ? { ...row, status: row.notAfter <= new Date() ? 'EXPIRED' : 'ACTIVE' } : null;
  }

  async install(companyId: string, userId: string, pfx: Buffer, passphrase: string) {
    const [membership] = await this.database.db.select({ role: companyUsers.role }).from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'))).limit(1);
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) throw new ForbiddenException('Apenas proprietário ou administrador pode cadastrar o certificado.');
    if (!passphrase || passphrase.length > 1024) throw new BadRequestException('Informe a senha do certificado.');
    const details = readPfx(pfx, passphrase);
    const id = randomUUID();
    const encryptedPayload = this.encrypt(companyId, id, pfx, passphrase);
    try {
      await this.database.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
        const [company] = await tx.select({ kind: companies.kind, taxId: companies.taxId, countryCode: companies.countryCode, role: companyUsers.role })
          .from(companies).innerJoin(companyUsers, and(eq(companyUsers.companyId, companies.id), eq(companyUsers.userId, userId)))
          .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'), eq(companyUsers.status, 'ACTIVE'))).limit(1);
        if (!company) throw new NotFoundException('Empresa não encontrada.');
        if (company.role !== 'OWNER' && company.role !== 'ADMIN') throw new ForbiddenException('Apenas proprietário ou administrador pode cadastrar o certificado.');
        if (!company.taxId || company.countryCode !== 'BR') throw new UnprocessableEntityException('Cadastre primeiro o CPF/CNPJ da empresa brasileira.');
        if (company.kind !== details.identity.kind || company.taxId !== details.identity.taxId)
          throw new UnprocessableEntityException('O CPF/CNPJ do certificado é diferente do cadastrado nesta empresa.');
        const [same] = await tx.select({ id: companyFiscalCertificates.id }).from(companyFiscalCertificates)
          .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'), eq(companyFiscalCertificates.fingerprintSha256, details.fingerprintSha256))).limit(1);
        if (same) throw new ConflictException('Este certificado já foi cadastrado nesta empresa.');
        await tx.update(companyFiscalCertificates).set({ status: 'REPLACED', encryptedPayload: null, disabledAt: new Date() })
          .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE')));
        await tx.insert(companyFiscalCertificates).values({ id, companyId, status: 'ACTIVE', subjectTaxId: details.identity.taxId,
          fingerprintSha256: details.fingerprintSha256, serialNumber: details.serialNumber, subjectSummary: details.subjectSummary,
          issuerSummary: details.issuerSummary, notBefore: details.notBefore, notAfter: details.notAfter,
          encryptedPayload, encryptionKeyId: this.keyId(), createdByUserId: userId });
        await tx.insert(companyFiscalCertificateEvents).values({ companyId, certificateId: id, actorUserId: userId, action: 'INSTALLED' });
      });
    } finally { pfx.fill(0); }
    return this.view(companyId);
  }

  async disable(companyId: string, userId: string) {
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
      const [membership] = await tx.select({ role: companyUsers.role }).from(companyUsers)
        .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'))).limit(1);
      if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) throw new ForbiddenException('Sem permissão para desativar o certificado.');
      const [row] = await tx.update(companyFiscalCertificates).set({ status: 'DISABLED', encryptedPayload: null, disabledAt: new Date() })
        .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).returning({ id: companyFiscalCertificates.id });
      if (!row) throw new NotFoundException('Nenhum certificado ativo nesta empresa.');
      await tx.insert(companyFiscalCertificateEvents).values({ companyId, certificateId: row.id, actorUserId: userId, action: 'DISABLED' });
    });
  }
}
