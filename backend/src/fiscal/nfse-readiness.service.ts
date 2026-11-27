import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { companies, companyFiscalCertificates, nfseSeries } from '@gestaonf/database/schema';
import { isValidCnpj } from '../customers/tax-id.js';
import { DatabaseService } from '../database/database.module.js';
import { CertificateService } from './certificate.service.js';
import { dpsIdentifier } from './nfse-contract.js';
import { NationalNfseClient, nationalErrors } from './nfse-national.client.js';
import { requireMembershipPermission, requireMembershipPolicy } from '../permissions/permission-resolver.js';

export type ReadinessCheck = { code: string; label: string; status: 'OK' | 'WARNING' | 'ERROR'; message: string };
export type ConnectionResult = { ok: boolean; outcome: 'ACCEPTED' | 'REFUSED' | 'UNEXPECTED' | 'UNREACHABLE'; httpStatus: number | null; probe: string; message: string };

@Injectable()
export class NfseReadinessService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CertificateService) private readonly certificates: CertificateService, @Inject(NationalNfseClient) private readonly client: NationalNfseClient) {}

  async check(companyId: string, userId: string) {
    await requireMembershipPolicy(this.database.db, userId, companyId, { kind: 'any', keys: ['sales.nfse_issue', 'sales.nfse_edit', 'fiscal.series'] }, 'GET /fiscal/nfse/readiness');
    const checks: ReadinessCheck[] = [];
    const add = (code: string, label: string, status: ReadinessCheck['status'], message: string) => checks.push({ code, label, status, message });

    const [company] = await this.database.db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    const [certificate] = await this.database.db.select({
      notAfter: companyFiscalCertificates.notAfter,
      subjectTaxId: companyFiscalCertificates.subjectTaxId,
    }).from(companyFiscalCertificates)
      .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).limit(1);
    if (!certificate) {
      add('CERTIFICATE', 'Certificado A1 da empresa', 'ERROR', 'Cadastre o certificado A1 da empresa em Empresa → Certificado digital.');
    } else if (certificate.notAfter <= new Date()) {
      add('CERTIFICATE', 'Certificado A1 da empresa', 'ERROR', 'O certificado venceu. Cadastre um certificado A1 válido em Empresa → Certificado digital.');
    } else if (certificate.subjectTaxId !== company.taxId) {
      add('CERTIFICATE', 'Certificado A1 da empresa', 'ERROR', 'Cadastre um certificado A1 vinculado ao CNPJ da empresa.');
    } else {
      add('CERTIFICATE', 'Certificado A1 da empresa', 'OK', `Cadastrado, com validade até ${certificate.notAfter.toLocaleDateString('pt-BR')}.`);
    }

    const problems: string[] = [];
    if (company.kind !== 'PJ' || company.countryCode !== 'BR' || !company.taxId || !isValidCnpj(company.taxId)) problems.push('Informe um CNPJ válido de empresa brasileira.');
    if (!company.cityIbgeCode) problems.push('Informe o CEP da empresa no cadastro para identificarmos o município.');
    if (!['2', '3'].includes(company.simplesNationalOption ?? '')) problems.push('Informe o enquadramento no Simples Nacional (MEI ou ME/EPP).');
    problems.length ? add('COMPANY', 'Cadastro da empresa', 'ERROR', problems.join(' ')) : add('COMPANY', 'Cadastro da empresa', 'OK', 'Dados fiscais completos.');
    if (company.simplesNationalOption === '3') {
      company.municipalRegistration ? add('COMPANY_IM', 'Inscrição municipal', 'OK', `Informada (${company.municipalRegistration}).`)
        : add('COMPANY_IM', 'Inscrição municipal', 'WARNING', 'Se a empresa possui inscrição municipal, informe o número no cadastro da empresa.');
    }

    const compatible = await this.compatibleSeries(companyId, company.taxId, company.cityIbgeCode);
    const selected = this.selectSeries(compatible);
    selected ? add('SERIES', 'Série de homologação', 'OK', `Série ${selected.seriesNumber}, próximo número ${selected.nextNumber}.`)
      : add('SERIES', 'Série de homologação', 'ERROR', compatible.length ? 'Defina uma única série padrão de homologação em Fiscal → Séries e numeração.' : 'Cadastre uma série de homologação compatível com o CNPJ e o município da empresa (número de 1 a 49999).');

    company.simplesNationalOption === '2' ? add('CONVENIO', 'Convênio do município', 'OK', 'O MEI é dispensado da verificação de convênio do município.')
      : add('CONVENIO', 'Convênio do município', 'WARNING', 'Confirme no Portal Nacional da NFS-e se o município da empresa está habilitado para a emissão.');
    return { environment: 'HOMOLOGATION' as const, ready: !checks.some(check => check.status === 'ERROR'), checks };
  }

  /** Read-only probe: asks for a DPS number that was never used. It proves URL, TLS, certificate and permission without consuming a number. */
  async connection(companyId: string, userId: string): Promise<ConnectionResult> {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.series', 'POST /fiscal/nfse/readiness/connection');
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
