import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { ForbiddenException } from '@nestjs/common';
import * as s from '@gestaonf/database/schema';
import { NfseReadinessService } from '../src/fiscal/nfse-readiness.service.js';
import { createIsolatedDatabase, createWorld, fiscalServices, testCredential, type NationalCall, type TestDb } from './nfse-fixtures.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>>;
let db: TestDb;
let world: Awaited<ReturnType<typeof createWorld>>;
let dir: string;
const saved = { ...process.env };
const ENV_KEYS = ['NFSE_HOMOLOGATION_ENABLED', 'NFSE_CONTRACT_CONFIRMED', 'NFSE_SIGNATURE_PROFILE', 'NFSE_SEFIN_HOMOLOGATION_URL', 'NFSE_ICP_BRASIL_CA_BUNDLE'];

beforeAll(async () => { isolated = await createIsolatedDatabase('nfse_ready'); db = isolated.db; dir = mkdtempSync(join(tmpdir(), 'nfse-ready-')); }, 60_000);
afterAll(async () => { await isolated?.drop(); rmSync(dir, { recursive: true, force: true }); }, 30_000);
beforeEach(async () => { world = await createWorld(db); }, 30_000);
afterEach(() => { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

function readiness(call?: NationalCall) {
  const services = fiscalServices(db, world, call);
  return { services, readiness: new NfseReadinessService(services.database, services.previews, services.certificates as never, services.national) };
}
function bundle() { const path = join(dir, 'icp.pem'); writeFileSync(path, testCredential().cert); process.env.NFSE_ICP_BRASIL_CA_BUNDLE = path; return path; }
const byCode = (result: Awaited<ReturnType<NfseReadinessService['check']>>, code: string) => result.checks.find(c => c.code === code)!;

describe('prontidão para emitir', () => {
  it('sem nenhuma configuração do servidor, aponta cada pendência', async () => {
    const { readiness: service } = readiness();
    for (const key of ENV_KEYS) delete process.env[key];
    const result = await service.check(world.company, world.owner);
    expect(result.ready).toBe(false);
    for (const code of ['ENV_ENABLED', 'ENV_CONTRACT', 'ENV_PROFILE', 'ENV_URL', 'ICP_BUNDLE']) expect(byCode(result, code).status, code).toBe('ERROR');
    expect(byCode(result, 'COMPANY').status).toBe('OK');
    expect(byCode(result, 'SERIES').status).toBe('OK');
  });

  it('tudo configurado: pronto, com aviso do convênio no caso de ME/EPP', async () => {
    const { readiness: service } = readiness();
    bundle();
    await db.update(s.companies).set({ simplesNationalOption: '3', simplesTaxationRegime: '1' }).where(eq(s.companies.id, world.company));
    const result = await service.check(world.company, world.owner);
    expect(result.checks.filter(c => c.status === 'ERROR')).toEqual([]);
    expect(result.ready).toBe(true);
    expect(byCode(result, 'CONVENIO').status).toBe('WARNING');
    expect(byCode(result, 'COMPANY_IM').status).toBe('WARNING');
  });

  it('MEI não recebe avisos de convênio nem de inscrição municipal', async () => {
    const { readiness: service } = readiness();
    bundle();
    const result = await service.check(world.company, world.owner);
    expect(result.ready).toBe(true);
    expect(byCode(result, 'CONVENIO').status).toBe('OK');
    expect(result.checks.find(c => c.code === 'COMPANY_IM')).toBeUndefined();
  });

  it('URL sem o caminho base gera aviso, e host errado gera erro', async () => {
    const { readiness: service } = readiness();
    bundle();
    process.env.NFSE_SEFIN_HOMOLOGATION_URL = 'https://sefin.producaorestrita.nfse.gov.br';
    expect(byCode(await service.check(world.company, world.owner), 'ENV_URL').status).toBe('WARNING');
    process.env.NFSE_SEFIN_HOMOLOGATION_URL = 'https://example.com/SefinNacional';
    expect(byCode(await service.check(world.company, world.owner), 'ENV_URL').status).toBe('ERROR');
  });

  it('cadeia ICP-Brasil inexistente ou vazia é erro', async () => {
    const { readiness: service } = readiness();
    process.env.NFSE_ICP_BRASIL_CA_BUNDLE = join(dir, 'nao-existe.pem');
    expect(byCode(await service.check(world.company, world.owner), 'ICP_BUNDLE').status).toBe('ERROR');
    const empty = join(dir, 'vazio.pem'); writeFileSync(empty, 'sem certificados'); process.env.NFSE_ICP_BRASIL_CA_BUNDLE = empty;
    expect(byCode(await service.check(world.company, world.owner), 'ICP_BUNDLE').status).toBe('ERROR');
  });

  it('cadastro incompleto da empresa: ME/EPP sem regime de apuração, sem município e sem certificado', async () => {
    const { readiness: service } = readiness();
    bundle();
    await db.update(s.companies).set({ simplesNationalOption: '3', simplesTaxationRegime: null, cityIbgeCode: null }).where(eq(s.companies.id, world.company));
    await db.delete(s.companyFiscalCertificates).where(eq(s.companyFiscalCertificates.companyId, world.company));
    const result = await service.check(world.company, world.owner);
    expect(result.ready).toBe(false);
    expect(byCode(result, 'COMPANY').status).toBe('ERROR');
    expect(byCode(result, 'COMPANY').message).toMatch(/município/i);
    expect(byCode(result, 'COMPANY').message).toMatch(/apuração/i);
    expect(byCode(result, 'CERTIFICATE').status).toBe('ERROR');
  });

  it('série de homologação ausente ou ambígua é erro', async () => {
    const { readiness: service } = readiness();
    bundle();
    await db.delete(s.nfseSeries).where(eq(s.nfseSeries.companyId, world.company));
    expect(byCode(await service.check(world.company, world.owner), 'SERIES').status).toBe('ERROR');
    const make = (number: number) => db.insert(s.nfseSeries).values({ companyId: world.company, environment: 'HOMOLOGATION', issuerTaxIdSnapshot: world.issuerTaxId, municipalityIbgeCode: '3304557', seriesNumber: number, initialNumber: 1n, nextNumber: 1n, isDefault: false, createdByUserId: world.owner });
    await make(1); await make(2);
    const result = await service.check(world.company, world.owner);
    expect(byCode(result, 'SERIES').status).toBe('ERROR');
    expect(byCode(result, 'SERIES').message).toMatch(/única série padrão/);
  });

  it('só proprietário ou administrador consulta', async () => {
    const { readiness: service } = readiness();
    await expect(service.check(world.company, world.other)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.connection(world.company, world.other)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('teste de conexão', () => {
  const calls: Array<{ method: string; path: string }> = [];
  beforeEach(() => { calls.length = 0; });
  const probe = (status: number, body: Record<string, unknown>) => readiness(async (method, path) => { calls.push({ method, path }); return { status, body }; }).readiness;

  it('consulta uma DPS ainda não usada, sem consumir número', async () => {
    const service = probe(404, { erros: [{ codigo: 'E2404', descricao: 'DPS não encontrada' }] });
    const result = await service.connection(world.company, world.owner);
    expect(calls).toEqual([{ method: 'GET', path: `/dps/DPS3304557${'2'}${world.issuerTaxId}00001${'1'.padStart(15, '0')}` }]);
    expect(result).toMatchObject({ ok: true, outcome: 'ACCEPTED', httpStatus: 404 });
    expect(result.message).toContain('E2404');
    const [series] = await db.select().from(s.nfseSeries).where(eq(s.nfseSeries.id, world.series.id));
    expect(series.nextNumber).toBe(1n);
    expect(await db.select().from(s.nfseDps).where(eq(s.nfseDps.companyId, world.company))).toHaveLength(0);
  });

  it('200 também prova a conexão', async () => {
    expect(await probe(200, { chaveAcesso: 'x' }).connection(world.company, world.owner)).toMatchObject({ ok: true, outcome: 'ACCEPTED', httpStatus: 200 });
  });

  it('404 sem erro de negócio indica caminho base errado', async () => {
    const result = await probe(404, {}).connection(world.company, world.owner);
    expect(result).toMatchObject({ ok: false, outcome: 'REFUSED', httpStatus: 404 });
    expect(result.message).toMatch(/caminho base/i);
  });

  it('401 e 403 indicam certificado ou permissão recusados', async () => {
    for (const status of [401, 403]) {
      const result = await probe(status, {}).connection(world.company, world.owner);
      expect(result).toMatchObject({ ok: false, outcome: 'REFUSED', httpStatus: status });
      expect(result.message).toMatch(/certificado/i);
    }
  });

  it('500 é inconclusivo', async () => {
    expect(await probe(500, {}).connection(world.company, world.owner)).toMatchObject({ ok: false, outcome: 'UNEXPECTED', httpStatus: 500 });
  });

  it('falha de rede devolve UNREACHABLE com a causa', async () => {
    const { readiness: service } = readiness(async () => { throw new Error('Falha na conexão com o ambiente nacional.'); });
    const result = await service.connection(world.company, world.owner);
    expect(result).toMatchObject({ ok: false, outcome: 'UNREACHABLE', httpStatus: null });
    expect(result.message).toContain('Falha na conexão');
  });

  it('sem série de homologação não há o que sondar', async () => {
    const { readiness: service } = readiness();
    await db.delete(s.nfseSeries).where(eq(s.nfseSeries.companyId, world.company));
    await expect(service.connection(world.company, world.owner)).rejects.toMatchObject({ response: { code: 'SERIES_REQUIRED' } });
  });
});
