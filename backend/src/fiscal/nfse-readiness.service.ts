import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { companies, companyFiscalCertificates, nfseSeries } from '@gestaonf/database/schema';
import { isValidCnpj } from '../customers/tax-id.js';
import { DatabaseService } from '../database/database.module.js';
import { CertificateService } from './certificate.service.js';
import { dpsIdentifier } from './nfse-contract.js';
import { NationalNfseClient, nationalErrors } from './nfse-national.client.js';
import { NfsePreviewService } from './nfse-preview.service.js';

export type ReadinessCheck = { code: string; label: string; status: 'OK' | 'WARNING' | 'ERROR'; message: string };
export type ConnectionResult = { ok: boolean; outcome: 'ACCEPTED' | 'REFUSED' | 'UNEXPECTED' | 'UNREACHABLE'; httpStatus: number | null; probe: string; message: string };

/**
 * Tells, before any DPS number is consumed, whether homologation emission can work: server configuration, certificate,
 * company data, series, and a read-only probe of the national environment.
 */
@Injectable()
export class NfseReadinessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(NfsePreviewService) private readonly previews: NfsePreviewService,
    @Inject(CertificateService) private readonly certificates: CertificateService, @Inject(NationalNfseClient) private readonly client: NationalNfseClient) {}

  async check(companyId: string, userId: string) {
    await this.previews.manager(companyId, userId);
    const checks: ReadinessCheck[] = [];
    const add = (code: string, label: string, status: ReadinessCheck['status'], message: string) => checks.push({ code, label, status, message });

    process.env.NFSE_HOMOLOGATION_ENABLED === 'true' ? add('ENV_ENABLED', 'Envio em homologação habilitado', 'OK', 'Habilitado no servidor.')
      : add('ENV_ENABLED', 'Envio em homologação habilitado', 'ERROR', 'Defina NFSE_HOMOLOGATION_ENABLED=true no servidor.');
    process.env.NFSE_CONTRACT_CONFIRMED === 'true' ? add('ENV_CONTRACT', 'Contrato da API confirmado', 'OK', 'Confirmado no servidor.')
      : add('ENV_CONTRACT', 'Contrato da API confirmado', 'ERROR', 'Confira no Swagger do ambiente a URL, os campos JSON e o algoritmo de assinatura; depois defina NFSE_CONTRACT_CONFIRMED=true.');
    const profile = process.env.NFSE_SIGNATURE_PROFILE;
    profile === 'RSA_SHA1' || profile === 'RSA_SHA256' ? add('ENV_PROFILE', 'Perfil de assinatura', 'OK', `Perfil ${profile}.`)
      : add('ENV_PROFILE', 'Perfil de assinatura', 'ERROR', 'Defina NFSE_SIGNATURE_PROFILE como RSA_SHA256 ou RSA_SHA1, conforme o Swagger do ambiente.');
    try {
      const url = new URL(this.client.configuration());
      url.pathname.toLowerCase().includes('/sefinnacional') ? add('ENV_URL', 'URL da SEFIN de homologação', 'OK', url.href)
        : add('ENV_URL', 'URL da SEFIN de homologação', 'WARNING', `${url.href} não contém o caminho base /SefinNacional. Confirme a URL completa no Swagger; o teste de conexão mostra se o caminho está certo.`);
    } catch (error) { add('ENV_URL', 'URL da SEFIN de homologação', 'ERROR', error instanceof Error ? error.message : 'URL inválida.'); }

    const bundlePath = process.env.NFSE_ICP_BRASIL_CA_BUNDLE;
    if (!bundlePath) add('ICP_BUNDLE', 'Cadeia de confiança ICP-Brasil', 'ERROR', 'Defina NFSE_ICP_BRASIL_CA_BUNDLE com o caminho absoluto de config/fiscal/icp-brasil-ca.pem.');
    else {
      const count = (await readFile(bundlePath, 'utf8').catch(() => null))?.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? null;
      count === null ? add('ICP_BUNDLE', 'Cadeia de confiança ICP-Brasil', 'ERROR', `Não foi possível ler ${bundlePath}.`)
        : count === 0 ? add('ICP_BUNDLE', 'Cadeia de confiança ICP-Brasil', 'ERROR', 'O arquivo não contém nenhum certificado PEM.')
        : add('ICP_BUNDLE', 'Cadeia de confiança ICP-Brasil', 'OK', `${count} certificado(s) raiz carregado(s).`);
    }

    const [certificate] = await this.database.db.select({ notAfter: companyFiscalCertificates.notAfter }).from(companyFiscalCertificates)
      .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).limit(1);
    if (!certificate) add('CERTIFICATE', 'Certificado A1 da empresa', 'ERROR', 'Cadastre o certificado A1 da empresa em Empresa → Certificado digital.');
    else {
      try { await this.certificates.withSigningCredential(companyId, async () => undefined); add('CERTIFICATE', 'Certificado A1 da empresa', 'OK', `Válido e confiável até ${certificate.notAfter.toLocaleDateString('pt-BR')}.`); }
      catch (error) { add('CERTIFICATE', 'Certificado A1 da empresa', 'ERROR', error instanceof Error ? error.message : 'Não foi possível validar o certificado.'); }
    }

    const [company] = await this.database.db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    const problems: string[] = [];
    if (company.kind !== 'PJ' || company.countryCode !== 'BR' || !company.taxId || !isValidCnpj(company.taxId)) problems.push('Informe um CNPJ válido de empresa brasileira.');
    if (!company.cityIbgeCode) problems.push('Informe o município da empresa com código IBGE.');
    if (!['2', '3'].includes(company.simplesNationalOption ?? '')) problems.push('Informe o enquadramento no Simples Nacional (MEI ou ME/EPP).');
    if (company.simplesNationalOption === '3' && company.simplesTaxationRegime !== '1') problems.push('Informe a forma de apuração do Simples Nacional (ISS dentro do DAS).');
    if (company.specialTaxRegime && company.specialTaxRegime !== '0') problems.push('Regimes municipais especiais ainda não são suportados.');
    problems.length ? add('COMPANY', 'Cadastro da empresa', 'ERROR', problems.join(' ')) : add('COMPANY', 'Cadastro da empresa', 'OK', 'Dados fiscais completos.');
    if (company.simplesNationalOption === '3') {
      company.municipalRegistration ? add('COMPANY_IM', 'Inscrição municipal', 'OK', `Informada (${company.municipalRegistration}).`)
        : add('COMPANY_IM', 'Inscrição municipal', 'WARNING', 'Se a empresa tem inscrição municipal cadastrada no município, ela precisa constar na nota (regra E0116). Sem ela, a nota pode ser rejeitada.');
    }

    const compatible = await this.compatibleSeries(companyId, company.taxId, company.cityIbgeCode);
    const selected = this.selectSeries(compatible);
    selected ? add('SERIES', 'Série de homologação', 'OK', `Série ${selected.seriesNumber}, próximo número ${selected.nextNumber}.`)
      : add('SERIES', 'Série de homologação', 'ERROR', compatible.length ? 'Defina uma única série padrão de homologação em Fiscal → Séries e numeração.' : 'Cadastre uma série de homologação compatível com o CNPJ e o município da empresa (número de 1 a 49999).');

    company.simplesNationalOption === '2' ? add('CONVENIO', 'Convênio do município', 'OK', 'O MEI é dispensado da verificação de convênio do município.')
      : add('CONVENIO', 'Convênio do município', 'WARNING', 'O município precisa ter convênio ativo com o Sistema Nacional NFS-e (regras E0037, E0038 e E1270). Este sistema ainda não consulta o convênio; confirme em gov.br/nfse antes de emitir.');
    return { environment: 'HOMOLOGATION' as const, ready: !checks.some(check => check.status === 'ERROR'), checks };
  }

  /** Read-only probe: asks for a DPS number that was never used. It proves URL, TLS, certificate and permission without consuming a number. */
  async connection(companyId: string, userId: string): Promise<ConnectionResult> {
    await this.previews.manager(companyId, userId);
    const [company] = await this.database.db.select({ taxId: companies.taxId, city: companies.cityIbgeCode }).from(companies).where(eq(companies.id, companyId)).limit(1);
    const series = this.selectSeries(await this.compatibleSeries(companyId, company.taxId, company.city));
    if (!series) throw new UnprocessableEntityException({ code: 'SERIES_REQUIRED', message: 'Configure uma série padrão de homologação para fazer o teste de conexão.' });
    const probe = `/dps/${encodeURIComponent(dpsIdentifier(series.municipalityIbgeCode, series.issuerTaxIdSnapshot, series.seriesNumber, series.nextNumber.toString()))}`;
    try {
      const response = await this.certificates.withSigningCredential(companyId, credential => this.client.call('GET', probe, credential, undefined, undefined, true));
      const errors = nationalErrors(response.body);
      const result = (outcome: ConnectionResult['outcome'], message: string): ConnectionResult => ({ ok: outcome === 'ACCEPTED', outcome, httpStatus: response.status, probe: `GET ${probe}`, message });
      if (response.status >= 200 && response.status < 300) return result('ACCEPTED', 'Conexão, certificado e URL aceitos pelo ambiente nacional.');
      if (response.status === 401 || response.status === 403) return result('REFUSED', `O ambiente nacional recusou o certificado ou a permissão (HTTP ${response.status}). Confira se o certificado é o e-CNPJ do emitente e se a URL é a do ambiente de produção restrita.`);
      if (errors && response.status < 500) return result('ACCEPTED', `Conexão, certificado e URL aceitos. Resposta do ambiente nacional: ${errors}`);
      if (response.status === 404) return result('REFUSED', 'O ambiente nacional respondeu 404 sem erro de negócio: o caminho base da URL provavelmente está errado (confira o /SefinNacional no Swagger).');
      return result('UNEXPECTED', `Resposta inesperada do ambiente nacional (HTTP ${response.status}). Tente novamente; se persistir, o ambiente pode estar instável.`);
    } catch (error) {
      return { ok: false, outcome: 'UNREACHABLE', httpStatus: null, probe: `GET ${probe}`, message: error instanceof Error ? error.message.slice(0, 600) : 'Não foi possível conectar ao ambiente nacional.' };
    }
  }

  private async compatibleSeries(companyId: string, taxId: string | null, city: string | null) {
    const rows = await this.database.db.select().from(nfseSeries).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.environment, 'HOMOLOGATION'), eq(nfseSeries.status, 'ACTIVE')));
    return rows.filter(row => row.issuerTaxIdSnapshot === taxId && row.municipalityIbgeCode === city);
  }

  /** Same rule the preview uses: the single default series, or the only compatible one. */
  private selectSeries(series: Array<typeof nfseSeries.$inferSelect>) {
    const defaults = series.filter(row => row.isDefault);
    return defaults.length === 1 ? defaults[0] : defaults.length === 0 && series.length === 1 ? series[0] : null;
  }
}
