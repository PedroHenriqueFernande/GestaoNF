import { randomUUID } from 'node:crypto';
import forge from 'node-forge';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { and, eq, lt } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { testAccount } from './account-fixture.js';
import { SalesService } from '../src/sales/sales.service.js';
import type { DatabaseService } from '../src/database/database.module.js';
import type { NfseSnapshot } from '../src/fiscal/nfse.types.js';
import { NfsePreviewService } from '../src/fiscal/nfse-preview.service.js';
import { NfseIssuanceService } from '../src/fiscal/nfse-issuance.service.js';
import { NationalNfseClient } from '../src/fiscal/nfse-national.client.js';
import { NfseDocumentActionsService } from '../src/fiscal/nfse-document-actions.service.js';
import { NfseEventProcessorService } from '../src/fiscal/nfse-event-processor.service.js';
import { NfseProcessorService } from '../src/fiscal/nfse-processor.service.js';

export type TestDb = ReturnType<typeof drizzle<typeof s>>;
let cnpjCounter = 10000000;
/** Valid CNPJ (with check digits), unique per call, so series identities never collide between tests. */
export function newCnpj() {
  const base = `${++cnpjCounter}0001`.split('').map(Number);
  const digit = (digits: number[]) => { const weights = digits.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const sum = digits.reduce((total, d, i) => total + d * weights[i], 0) % 11; return sum < 2 ? 0 : 11 - sum; };
  const first = digit(base); const second = digit([...base, first]);
  return [...base, first, second].join('');
}
export const CUSTOMER_TAX_ID = '52998224725';
export const CITY = '3304557';
export const NATIONAL_TAX_CODE = '100101';

/** Creates an isolated database with every migration applied. */
export async function createIsolatedDatabase(prefix: string) {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco isolado');
  const name = `gestaonf_${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(databaseUrl); url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  const db = drizzle(client, { schema: s });
  const drop = async () => { await client.end({ timeout: 5 }); await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); await admin.end({ timeout: 5 }); };
  return { db, client, drop };
}

export function salesService(db: TestDb) {
  const files = { syncSaleInTx: async () => undefined };
  const fiscal = { resolveTax: async () => null };
  return new SalesService({ db } as unknown as DatabaseService, files as never, fiscal as never);
}

/** Company, owner, customer, service and active homologation series. */
export async function createWorld(db: TestDb) {
  const [owner, other] = (await db.insert(s.users).values(['Owner', 'Other'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning()).map(u => u.id);
  const issuerTaxId = newCnpj();
  const accountId = await testAccount(db, owner);
  const [company, otherCompany] = (await db.insert(s.companies).values([
    { accountId, name: 'Empresa Teste', legalName: 'Empresa Teste LTDA', kind: 'PJ', taxId: issuerTaxId, cityIbgeCode: CITY, countryCode: 'BR', simplesNationalOption: '2' },
    { accountId, name: 'Empresa B', kind: 'PJ' },
  ]).returning()).map(c => c.id);
  await db.insert(s.companyUsers).values([{ companyId: company, userId: owner, role: 'OWNER' }, { companyId: otherCompany, userId: other, role: 'OWNER' }]);
  const [customer] = await db.insert(s.customers).values({ companyId: company, kind: 'PF', name: 'Cliente Teste', taxId: CUSTOMER_TAX_ID, countryCode: 'BR' }).returning();
  const [service] = await db.insert(s.services).values({ companyId: company, name: 'Consultoria', nationalTaxCode: NATIONAL_TAX_CODE }).returning();
  const [series] = await db.insert(s.nfseSeries).values({ companyId: company, environment: 'HOMOLOGATION', issuerTaxIdSnapshot: issuerTaxId, municipalityIbgeCode: CITY, seriesNumber: 1, initialNumber: 1n, nextNumber: 1n, isDefault: true, createdByUserId: owner }).returning();
  const [secondService] = await db.insert(s.services).values({ companyId: company, name: 'Treinamento', nationalTaxCode: '100102' }).returning();
  const [certificate] = await db.insert(s.companyFiscalCertificates).values({ companyId: company, subjectTaxId: issuerTaxId, fingerprintSha256: 'a'.repeat(64), serialNumber: '01', subjectSummary: 'CN=Teste', issuerSummary: 'CN=Teste', notBefore: new Date(Date.now() - 86400000), notAfter: new Date(Date.now() + 365 * 86400000), encryptedPayload: 'x', encryptionKeyId: 'v1', createdByUserId: owner }).returning();
  return { owner, other, company, otherCompany, customer, service, secondService, series, issuerTaxId, certificateId: certificate.id };
}

/** Confirmed sale built through the real SalesService, so snapshots and totals are authentic. */
export const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
export async function createConfirmedSale(db: TestDb, world: Awaited<ReturnType<typeof createWorld>>, lines: Array<{ serviceId: string; amount: string }> = [{ serviceId: world.service.id, amount: '100.00' }]) {
  const sales = salesService(db);
  const total = lines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0);
  const draft = await sales.create(world.company, world.owner, randomUUID(), {
    customerId: world.customer.id, soldOn: yesterday(),
    items: lines.map(line => ({ serviceId: line.serviceId, quantity: '1.0000', unitPrice: line.amount, discountAmount: '0.00' })),
    installments: [{ paymentMethod: 'PIX', amount: (total / 100).toFixed(2), dueOn: '2027-12-05' }],
  } as never);
  await sales.confirm(world.company, draft.id, world.owner, { expectedVersion: draft.version, initialReceipts: [] });
  return sales.get(world.company, draft.id);
}

type World = Awaited<ReturnType<typeof createWorld>>;
type Sale = Awaited<ReturnType<typeof createConfirmedSale>>;
const hex = (n: number) => String(n).padStart(64, '0').replace(/0/g, 'a').slice(0, 64);

export function accessKey(taxId: string, n: number) { return `${CITY}22${taxId}${String(n).padStart(27, '0')}`; }

/** Inserts an emission with one DPS (and optionally an official document) for the sale, in the requested state. */
export async function seedEmission(db: TestDb, world: World, sale: Sale, opts: { dpsStatus: 'RESERVED' | 'READY' | 'SENDING' | 'UNKNOWN' | 'REJECTED' | 'AUTHORIZED'; number: number; previousEmissionId?: string; kind?: 'ISSUE' | 'SUBSTITUTION'; substitutesDocumentId?: string; documentStatus?: 'AUTHORIZED' | 'CANCELLED' | 'SUBSTITUTED'; itemIds?: string[]; substitutionOpen?: { reasonCode: string; reasonText: string | null; saleVersion: number } }) {
  const itemIds = opts.itemIds ?? sale.items.map(i => i.id);
  const snapshot = { schemaVersion: 1, saleId: sale.id, saleVersion: sale.version, groups: [{ key: 'g1', items: itemIds.map(id => ({ id })) }] } as unknown as NfseSnapshot;
  const [preview] = await db.insert(s.nfsePreviews).values({ companyId: world.company, saleId: sale.id, saleVersion: sale.version, requestKey: randomUUID(), requestHash: hex(1), snapshotHash: hex(2), snapshot: snapshot as unknown as Record<string, unknown>, createdByUserId: world.owner }).returning();
  const [emission] = await db.insert(s.nfseEmissionRequests).values({ companyId: world.company, saleId: sale.id, previewId: preview.id, environment: 'HOMOLOGATION', requestKey: randomUUID(), requestHash: hex(3), createdByUserId: world.owner, kind: opts.kind ?? 'ISSUE', previousEmissionId: opts.previousEmissionId ?? null, substitutesDocumentId: opts.substitutesDocumentId ?? null }).returning();
  const [dps] = await db.insert(s.nfseDps).values({ companyId: world.company, seriesId: world.series.id, environment: 'HOMOLOGATION', issuerTaxIdSnapshot: world.issuerTaxId, municipalityIbgeCode: CITY, seriesNumber: 1, dpsNumber: BigInt(opts.number), sourceSaleId: sale.id, emissionId: emission.id, groupKey: 'g1',
    identifier: `DPS${CITY}2${world.issuerTaxId}00001${String(opts.number).padStart(15, '0')}`, snapshot: snapshot as unknown as Record<string, unknown>, requestKey: randomUUID(), requestHash: hex(4), status: opts.dpsStatus, createdByUserId: world.owner }).returning();
  // The real issuance advances the series counter; keep the seeded data consistent with it.
  await db.update(s.nfseSeries).set({ nextNumber: BigInt(opts.number) + 1n }).where(and(eq(s.nfseSeries.id, world.series.id), lt(s.nfseSeries.nextNumber, BigInt(opts.number) + 1n)));
  let document: typeof s.nfseDocuments.$inferSelect | undefined;
  if (opts.dpsStatus === 'AUTHORIZED') {
    [document] = await db.insert(s.nfseDocuments).values({ companyId: world.company, dpsId: dps.id, environment: 'HOMOLOGATION', accessKey: accessKey(world.issuerTaxId, opts.number), number: String(opts.number), officialXml: '<NFSe/>', xmlSha256: hex(5), authorizedAt: new Date(), status: opts.documentStatus ?? 'AUTHORIZED',
      ...(opts.substitutionOpen ? { substitutionReasonCode: opts.substitutionOpen.reasonCode, substitutionReasonText: opts.substitutionOpen.reasonText, substitutionOpenedByUserId: world.owner, substitutionOpenedAt: new Date(), substitutionSaleVersion: opts.substitutionOpen.saleVersion } : {}) }).returning();
  }
  return { emission, dps, document };
}

export async function seedCancellationEvent(db: TestDb, world: World, documentId: string, status: 'PENDING' | 'READY' | 'SENDING' | 'UNKNOWN' | 'REGISTERED' | 'REJECTED') {
  const [document] = await db.select().from(s.nfseDocuments).where(and(eq(s.nfseDocuments.companyId, world.company), eq(s.nfseDocuments.id, documentId)));
  const [event] = await db.insert(s.nfseDocumentEvents).values({ companyId: world.company, documentId, environment: 'HOMOLOGATION', eventType: '101101', reasonCode: '1', reasonText: 'Erro de digitação no valor', identifier: `PRE${document.accessKey}101101`, status, requestKey: randomUUID(), requestHash: hex(6), createdByUserId: world.owner }).returning();
  return event;
}

let cachedCredential: { key: string; cert: string } | undefined;
export function testCredential() {
  if (cachedCredential) return cachedCredential;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000); cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'GESTAONF TESTE' }];
  cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey, forge.md.sha256.create());
  return cachedCredential = { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
}

export function enableHomologation() {
  Object.assign(process.env, { NFSE_HOMOLOGATION_ENABLED: 'true', NFSE_CONTRACT_CONFIRMED: 'true', NFSE_SIGNATURE_PROFILE: 'RSA_SHA256', NFSE_SEFIN_HOMOLOGATION_URL: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional' });
}

export type NationalCall = (method: 'GET' | 'POST', path: string, body?: string, field?: string) => Promise<{ status: number; body: Record<string, unknown> }>;

/** Real preview/issuance services over the test database; certificate and government endpoint are stubbed. */
export function fiscalServices(db: TestDb, world: World, call: NationalCall = async () => { throw new Error('sem chamada fiscal neste teste'); }) {
  enableHomologation();
  const database = { db } as unknown as DatabaseService;
  const certificates = { withSigningCredential: async (_companyId: string, use: (credential: { certificateId: string; key: string; cert: string; pfx: Buffer; passphrase: string }) => Promise<unknown>) => use({ certificateId: world.certificateId, ...testCredential(), pfx: Buffer.alloc(0), passphrase: '' }) };
  const national = Object.assign(new NationalNfseClient(), { call: async (method: 'GET' | 'POST', path: string, _credential: unknown, xml?: string, field?: string) => call(method, path, xml, field) });
  const previews = new NfsePreviewService(database, certificates as never);
  const issuance = new NfseIssuanceService(database, previews, national);
  const actions = new NfseDocumentActionsService(database, previews);
  const events = new NfseEventProcessorService(database, certificates as never, national);
  const processor = new NfseProcessorService(database, certificates as never, national, {} as never);
  return { database, certificates, national, previews, issuance, actions, events, processor };
}

export async function previewAndEmit(services: ReturnType<typeof fiscalServices>, world: World, saleId: string) {
  const preview = await services.previews.create(world.company, world.owner, saleId, randomUUID(), {});
  return services.issuance.emit(world.company, world.owner, saleId, preview.id, randomUUID());
}

/** What the national environment returns after registering a cancellation: an evento that wraps our signed request. */
export async function governmentEventResponse(requestXml: string, sequence = 1) {
  const { gzipSync } = await import('node:zlib');
  const { signXml } = await import('../src/fiscal/nfse-contract.js');
  const key = /Id="PRE(\d{50})101101"/.exec(requestXml)![1];
  const pedido = requestXml.replace(/^<\?xml[^>]*\?>/, '');
  const credential = testCredential();
  const unsigned = `<?xml version="1.0" encoding="UTF-8"?><evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infEvento Id="EVT${key}101101${String(sequence).padStart(3, '0')}"><verAplic>ADN-1.0</verAplic><ambGer>2</ambGer><nSeqEvento>${sequence}</nSeqEvento><dhProc>${new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')}</dhProc><nDFSe>1</nDFSe>${pedido}</infEvento></evento>`;
  const signed = signXml(unsigned, 'infEvento', credential.key, credential.cert, 'RSA_SHA256');
  return { status: 200, body: { eventoXmlGZipB64: gzipSync(Buffer.from(signed, 'utf8')).toString('base64') } };
}

/**
 * What the national environment returns for an accepted DPS: an official NFSe that embeds the signed DPS.
 * Valid against NFSe_v1.01.xsd. `substitutedKey` replaces the key referenced by <subst> to simulate a mismatching answer.
 */
export async function officialNfseResponse(signedDpsXml: string, opts: { substitutedKey?: string; unknownField?: boolean } = {}) {
  const { gzipSync } = await import('node:zlib');
  const { signXml } = await import('../src/fiscal/nfse-contract.js');
  const id = /Id="DPS(\d{7})2([0-9A-Z]{14})(\d{5})(\d{15})"/.exec(signedDpsXml)!;
  const [, city, cnpj, , digits] = id;
  const n = Number(digits);
  const key = `${city}22${cnpj}${String(n).padStart(27, '0')}`;
  let dps = signedDpsXml.replace(/^<\?xml[^>]*\?>/, '');
  if (opts.substitutedKey) dps = dps.replace(/<chSubstda>\d{50}<\/chSubstda>/, `<chSubstda>${opts.substitutedKey}</chSubstda>`);
  const gross = /<vServ>([\d.]+)<\/vServ>/.exec(dps)![1];
  const unsigned = `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${key}"><xLocEmi>Rio de Janeiro</xLocEmi><xLocPrestacao>Rio de Janeiro</xLocPrestacao><nNFSe>${n}</nNFSe><xTribNac>Servico</xTribNac><verAplic>ADN-1.0</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>100</cStat><dhProc>${new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')}</dhProc><nDFSe>${n}</nDFSe><emit><CNPJ>${cnpj}</CNPJ><xNome>Empresa Teste LTDA</xNome><enderNac><xLgr>Rua A</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>${city}</cMun><UF>RJ</UF><CEP>20000000</CEP></enderNac></emit><valores><vLiq>${gross}</vLiq></valores>${dps}${opts.unknownField ? '<campoNovo>valor</campoNovo>' : ''}</infNFSe></NFSe>`;
  const credential = testCredential();
  const signed = signXml(unsigned, 'infNFSe', credential.key, credential.cert, 'RSA_SHA256');
  return { status: 200, body: { nfseXmlGZipB64: gzipSync(Buffer.from(signed, 'utf8')).toString('base64'), chaveAcesso: key } };
}

/** Emits the sale through the real services and lets the real processor authorize it against the simulated government. */
export async function emitAndAuthorize(services: ReturnType<typeof fiscalServices>, world: World, saleId: string) {
  const emission = await previewAndEmit(services, world, saleId);
  const [dps] = (await services.database.db.select().from(s.nfseDps).where(eq(s.nfseDps.emissionId, emission.id)));
  const outcome = await services.processor.process(world.company, dps.id);
  const [document] = await services.database.db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.dpsId, dps.id));
  return { emission, dps, document, outcome };
}
