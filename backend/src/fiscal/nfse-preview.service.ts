import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, customers, companyFiscalCertificates, companyUsers, nfseDocuments, nfseDps, nfsePreviews, nfseSeries, saleItems, sales, services, serviceMunicipalTaxCodes } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { isValidCnpj, isValidCpf } from '../customers/tax-id.js';
import { amount, cents } from '../sales/sales-money.js';
import { NFSE_CONTRACT, buildDps, hash, isOfficialNbsCode, officialService, validateFiscalXml } from './nfse-contract.js';
import type { NfsePreviewInput } from './nfse.schemas.js';
import type { NfseGroup, NfseIssue, NfseParty, NfsePreview, NfseSnapshot } from './nfse.types.js';
import { CertificateService } from './certificate.service.js';
import { saleFiscalState } from './sale-fiscal-state.js';

type Db = DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export function snapshotHash(snapshot: NfseSnapshot) {
  const { generatedAt: _, certificate: _cert, issues: _issues, ...data } = snapshot;
  return hash(JSON.stringify(data));
}

@Injectable()
export class NfsePreviewService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CertificateService) private readonly certificates: CertificateService) {}

  async manager(companyId: string, userId: string, db: Db = this.database.db) {
    const [member] = await db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'))).limit(1);
    if (!member || !['OWNER', 'ADMIN'].includes(member.role)) throw new ForbiddenException('Apenas proprietários e administradores podem emitir NFS-e.');
  }

  async build(companyId: string, saleId: string, input: NfsePreviewInput, db: Db = this.database.db): Promise<NfseSnapshot> {
    const [sale] = await db.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, saleId))).limit(1);
    if (!sale) throw new NotFoundException('Venda não encontrada.');
    if (input.expectedSaleVersion && input.expectedSaleVersion !== sale.version) throw new ConflictException('A venda mudou. Reabra o pedido antes de visualizar a nota.');
    const [[company], [customer], items, seriesRows, [cert], municipalCodes] = await Promise.all([
      db.select().from(companies).where(eq(companies.id, companyId)).limit(1),
      db.select().from(customers).where(and(eq(customers.companyId, companyId), eq(customers.id, sale.customerId))).limit(1),
      db.select({ item: saleItems, service: services }).from(saleItems).innerJoin(services, and(eq(services.companyId, saleItems.companyId), eq(services.id, saleItems.serviceId))).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, saleId))).orderBy(saleItems.position),
      db.select().from(nfseSeries).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.status, 'ACTIVE'))),
      db.select({ id: companyFiscalCertificates.id, notAfter: companyFiscalCertificates.notAfter }).from(companyFiscalCertificates).where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).limit(1),
      db.select().from(serviceMunicipalTaxCodes).where(eq(serviceMunicipalTaxCodes.companyId, companyId)),
    ]);
    if (!company || !customer) throw new NotFoundException('Empresa ou cliente não encontrado.');
    const issues: NfseIssue[] = [];
    const add = (code: string, message: string, field: string, target: NfseIssue['target'], severity: NfseIssue['severity'] = 'ERROR') => issues.push({ code, message, field, target, severity });
    const party = (p: typeof customer | typeof company, name: string): NfseParty => ({ name, taxId: p.taxId, email: p.email, street: p.street, number: p.number, district: p.district, cityName: p.cityName, cityIbgeCode: p.cityIbgeCode, postalCode: p.postalCode, stateCode: p.stateCode, municipalRegistration: p.municipalRegistration });
    const issuer = party(company, company.legalName || company.name);
    const recipient = party(customer, customer.name);
    if (sale.status !== 'CONFIRMED') add('SALE_NOT_CONFIRMED', 'Confirme a venda antes de emitir a nota.', 'status', 'sale');
    if (company.kind !== 'PJ' || company.countryCode !== 'BR' || !company.taxId || !isValidCnpj(company.taxId)) add('ISSUER_CNPJ', 'Preencha um CNPJ válido de empresa brasileira.', 'taxId', 'company');
    if (!company.cityIbgeCode) add('ISSUER_CITY', 'Informe o município da empresa com código IBGE.', 'cityIbgeCode', 'company');
    if (!['2', '3'].includes(company.simplesNationalOption ?? '')) add('SIMPLES_REQUIRED', 'A emissão atende MEI ou ME/EPP optantes pelo Simples Nacional. Revise o enquadramento.', 'simplesNationalOption', 'company');
    if (company.simplesNationalOption === '3' && company.simplesTaxationRegime !== '1') add('APURATION_UNSUPPORTED', 'Configure a apuração do Simples Nacional. ISS fora do DAS ainda não está disponível nesta versão.', 'simplesTaxationRegime', 'company');
    if (company.specialTaxRegime && company.specialTaxRegime !== '0') add('SPECIAL_REGIME_UNSUPPORTED', 'Este regime municipal precisa de um tratamento fiscal específico, ainda não disponível.', 'specialTaxRegime', 'company');
    if (customer.countryCode !== 'BR' || !customer.taxId || !(customer.kind === 'PF' ? isValidCpf(customer.taxId) : isValidCnpj(customer.taxId))) add('CUSTOMER_TAX_ID', 'Informe CPF/CNPJ válido de um cliente brasileiro.', 'taxId', 'customer');
    for (const [target, p] of [['company', issuer], ['customer', recipient]] as const) {
      if (p.name.length > 150) add('NAME_LENGTH', 'O nome para a nota deve ter até 150 caracteres.', 'name', target);
      if (p.email && p.email.length > 80) add('EMAIL_LENGTH', 'O e-mail para a nota deve ter até 80 caracteres.', 'email', target);
      if (p.district && p.district.length > 60) add('DISTRICT_LENGTH', 'O bairro para a nota deve ter até 60 caracteres.', 'district', target);
    }
    const addressParts = [recipient.street, recipient.number, recipient.district, recipient.postalCode, recipient.cityIbgeCode];
    if (addressParts.some(Boolean) && !addressParts.every(Boolean)) add('CUSTOMER_ADDRESS', 'Complete logradouro, número, bairro, CEP e município do cliente, ou remova o endereço incompleto.', 'street', 'customer');
    const compatible = seriesRows.filter(s => s.issuerTaxIdSnapshot === company.taxId && s.municipalityIbgeCode === company.cityIbgeCode);
    const defaults = compatible.filter(s => s.isDefault);
    const selected = defaults.length === 1 ? defaults[0] : defaults.length === 0 && compatible.length === 1 ? compatible[0] : null;
    if (!selected) add('SERIES_REQUIRED', compatible.length ? 'Defina uma única série padrão para a empresa em Fiscal → Séries e numeração.' : 'Cadastre uma série compatível com o CNPJ e município da empresa.', 'series', 'series');
    if (selected && selected.nextNumber > 999999999999999n) add('SERIES_EXHAUSTED', 'A numeração desta série está esgotada.', 'nextNumber', 'series');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: company.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const fiscal = await saleFiscalState(db, companyId, saleId);
    const substitution = fiscal.substitution;
    if (fiscal.inProgress) add('NFSE_IN_PROGRESS', 'Há uma solicitação fiscal em andamento para esta venda. Aguarde o resultado antes de emitir novamente.', 'status', 'sale');
    // Normal emission covers only the items without an active note; a substitute covers the whole sale.
    const included = substitution ? items : items.filter(({ item }) => !fiscal.coveredItemIds.has(item.id));
    if (!fiscal.inProgress && fiscal.activeDocuments.length && !substitution && !included.length) add('NFSE_ALREADY_AUTHORIZED', 'Todos os serviços desta venda já possuem NFS-e autorizada. Para corrigir a nota, cancele ou substitua a nota emitida.', 'status', 'sale');
    const groups = new Map<string, NfseGroup>();
    for (const { item, service } of included) {
      const competence = input.competence ?? item.performedOn ?? sale.soldOn ?? today;
      if (competence > today) add('FUTURE_COMPETENCE', `A competência de ${item.serviceNameSnapshot} não pode ser futura.`, 'competence', 'sale');
      if (!item.performedOn && !input.competence) add('CONFIRM_COMPETENCE', `Confira a data da prestação de ${item.serviceNameSnapshot}; foi sugerida a data da venda.`, 'competence', 'sale', 'WARNING');
      const code = item.nationalTaxCodeSnapshot ?? service.nationalTaxCode;
      const nbs = item.nbsCodeSnapshot ?? service.nbsCode;
      const city = input.municipalityIbgeCode ?? company.cityIbgeCode;
      const munCode = company.simplesNationalOption === '2' ? null : municipalCodes.find(c => c.serviceId === item.serviceId && c.municipalityIbgeCode === city)?.municipalTaxCode ?? null;
      if (!code) add('SERVICE_CODE_REQUIRED', `Informe a classificação nacional de ${item.serviceNameSnapshot}.`, item.serviceId, 'service');
      const official = code ? officialService(code) : undefined;
      if (code && !official) add('SERVICE_CODE_INVALID', `O código nacional de ${item.serviceNameSnapshot} não consta na tabela oficial desta versão.`, item.serviceId, 'service');
      if (official && (official.specificGroup !== '-' || official.incidenceAt !== 'PROVIDER')) add('SPECIAL_SERVICE_UNSUPPORTED', `${item.serviceNameSnapshot} exige informações ou regra de incidência específicas ainda não disponíveis nesta emissão.`, item.serviceId, 'service');
      if (nbs && !isOfficialNbsCode(nbs)) add('NBS_CODE_INVALID', `O código NBS de ${item.serviceNameSnapshot} não consta na tabela oficial desta versão.`, item.serviceId, 'service');
      if (city !== company.cityIbgeCode) add('SERVICE_CITY_UNSUPPORTED', 'A primeira versão atende prestação no município da empresa. A incidência em outro município precisa de validação específica.', 'municipalityIbgeCode', 'sale');
      const tax = item.taxSnapshot;
      if (tax?.issWithholdingSuggestion) add('WITHHOLDING_UNSUPPORTED', `A regra de ${item.serviceNameSnapshot} sugere retenção. Esta operação precisa do fluxo de retenções.`, item.serviceId, 'service');
      if (tax && ['pisRatePercent', 'cofinsRatePercent', 'csllRatePercent', 'irRatePercent', 'inssRatePercent'].some(k => Number(tax[k as keyof typeof tax] ?? 0) > 0)) add('FEDERAL_TAX_UNSUPPORTED', `Confira a regra de ${item.serviceNameSnapshot}: os tributos federais destacados precisam de um cenário específico.`, item.serviceId, 'service');
      const key = hash(JSON.stringify([competence, city, code, nbs, munCode, tax]));
      let group = groups.get(key);
      if (!group) {
        group = { key, competence, municipalityIbgeCode: city, nationalTaxCode: code, nbsCode: nbs, municipalTaxCode: munCode, description: '', grossAmount: '0.00', discountAmount: '0.00', totalAmount: '0.00', ruleName: tax?.profileName ?? null, issWithholding: !!tax?.issWithholdingSuggestion, issRatePercent: tax?.issRatePercent ?? null, items: [] };
        groups.set(key, group);
      }
      group.description += `${group.description ? '\n' : ''}${item.descriptionSnapshot || item.serviceNameSnapshot}`;
      group.grossAmount = amount(cents(group.grossAmount) + cents(item.grossAmount));
      group.discountAmount = amount(cents(group.discountAmount) + cents(item.discountAmount));
      group.totalAmount = amount(cents(group.totalAmount) + cents(item.totalAmount));
      group.items.push({ id: item.id, serviceId: item.serviceId, name: item.serviceNameSnapshot, quantity: item.quantity, unitPrice: item.unitPrice, grossAmount: item.grossAmount, discountAmount: item.discountAmount, totalAmount: item.totalAmount });
    }
    if (!items.length) add('SERVICES_REQUIRED', 'A venda precisa ter um serviço.', 'items', 'sale');
    const groupedTotal = [...groups.values()].reduce((total, group) => total + cents(group.totalAmount), 0n);
    const wholeSale = included.length === items.length;
    const includedTotal = included.reduce((total, { item }) => total + cents(item.totalAmount), 0n);
    if (substitution && groups.size === 1) {
      // National rules E0061/E0063: while the issuer stays MEI or ME/EPP, a substitute cannot change competence, recipient or service value.
      const [original] = await db.select({ snapshot: nfseDps.snapshot, groupKey: nfseDps.groupKey }).from(nfseDocuments)
        .innerJoin(nfseDps, and(eq(nfseDps.companyId, nfseDocuments.companyId), eq(nfseDps.id, nfseDocuments.dpsId)))
        .where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, substitution.documentId))).limit(1);
      const before = original?.snapshot as unknown as NfseSnapshot | undefined;
      const beforeGroup = before?.groups.find(g => g.key === original?.groupKey);
      const now = [...groups.values()][0];
      if (before && beforeGroup && ['2', '3'].includes(before.simplesOption ?? '') && ['2', '3'].includes(company.simplesNationalOption ?? '')) {
        const hint = ' Para MEI e ME/EPP o governo não aceita essa mudança na substituição: restaure o valor original ou cancele a nota e emita outra.';
        const date = (value: string) => value.split('-').reverse().join('/');
        const money = (value: string) => value.replace('.', ',');
        if (now.competence !== beforeGroup.competence) add('SUBSTITUTION_COMPETENCE_LOCKED', `A competência da nota substituta não pode mudar (a nota original é de ${date(beforeGroup.competence)}).${hint}`, 'competence', 'sale');
        if (before.customer.taxId !== recipient.taxId) add('SUBSTITUTION_CUSTOMER_LOCKED', `O tomador da nota substituta não pode mudar (a nota original é de ${before.customer.name}).${hint}`, 'customer', 'customer');
        if (cents(now.grossAmount) !== cents(beforeGroup.grossAmount)) add('SUBSTITUTION_VALUE_LOCKED', `O valor do serviço da nota substituta não pode mudar (a nota original é de R$ ${money(beforeGroup.grossAmount)}).${hint}`, 'totalAmount', 'sale');
      }
    }
    if (substitution && groups.size > 1) add('SUBSTITUTION_SINGLE_GROUP', 'A NFS-e substituta precisa ser uma única nota, mas os serviços atuais da venda têm classificações fiscais diferentes. Ajuste os serviços ou cancele a nota e emita novamente.', 'items', 'sale');
    if (groupedTotal !== (wholeSale ? cents(sale.totalAmount) : includedTotal)) add('SALE_TOTAL_MISMATCH', 'O total dos serviços não corresponde ao total da venda. Revise o pedido.', 'totalAmount', 'sale');
    for (const g of groups.values()) {
      if (g.description.length > 2000) add('DESCRIPTION_LENGTH', 'A descrição agrupada excede 2.000 caracteres. Revise os serviços.', 'description', 'sale');
      if (cents(g.totalAmount) <= 0n) add('VALUE_REQUIRED', 'O valor dos serviços da nota deve ser maior que zero.', 'totalAmount', 'sale');
    }
    if (company.simplesNationalOption === '3' && !input.simplesTotalTaxPercent) add('TOTAL_TAX_REQUIRED', 'Informe o percentual aproximado total dos tributos do Simples para esta prestação. Ele é diferente da alíquota do ISS.', 'simplesTotalTaxPercent', 'sale');
    if (!cert) add('CERTIFICATE_MISSING', 'Cadastre o certificado A1 da empresa para poder emitir. A prévia pode ser consultada.', 'certificate', 'company', 'WARNING');
    const snapshot: NfseSnapshot = { schemaVersion: 1, saleId, saleVersion: sale.version, orderCode: sale.orderCode, generatedAt: new Date().toISOString(), contractVersion: NFSE_CONTRACT,
      environment: selected?.environment as NfseSnapshot['environment'] ?? null, series: selected ? { id: selected.id, number: selected.seriesNumber, nextNumber: selected.nextNumber.toString(), version: selected.version } : null,
      issuer, customer: recipient, customerId: customer.id, simplesOption: company.simplesNationalOption, simplesTaxationRegime: company.simplesTaxationRegime, specialTaxRegime: company.specialTaxRegime ?? '0', groups: [...groups.values()], totalAmount: wholeSale ? sale.totalAmount : amount(includedTotal), issues,
      ...(substitution ? { substitution: { documentId: substitution.documentId, accessKey: substitution.accessKey, reasonCode: substitution.reasonCode, reasonText: substitution.reasonText } } : {}),
      input: { ...(input.competence ? { competence: input.competence } : {}), ...(input.municipalityIbgeCode ? { municipalityIbgeCode: input.municipalityIbgeCode } : {}), ...(input.simplesTotalTaxPercent ? { simplesTotalTaxPercent: input.simplesTotalTaxPercent } : {}) }, certificate: cert ? { id: cert.id, expiresAt: cert.notAfter.toISOString(), status: cert.notAfter > new Date() ? 'ACTIVE' : 'EXPIRED', trusted: false } : null };
    if (!issues.some(i => i.severity === 'ERROR') && selected?.environment === 'HOMOLOGATION') {
      for (const [i, group] of snapshot.groups.entries()) {
        try {
          const { xml } = buildDps(snapshot, group, String(selected.nextNumber + BigInt(i)), snapshot.generatedAt);
          const validation = await validateFiscalXml(xml);
          if (!validation.valid) add('XML_SCHEMA', 'A estrutura fiscal desta operação ainda não está pronta para emissão. Revise os dados e contate o suporte se persistir.', 'xml', 'integration');
        } catch { add('XML_VALIDATION_FAILED', 'Não foi possível conferir a estrutura fiscal. Tente novamente.', 'xml', 'integration'); }
      }
    }
    return snapshot;
  }

  async emissionIssues(companyId: string, snapshot: NfseSnapshot): Promise<NfseIssue[]> {
    const result: NfseIssue[] = [];
    const add = (code: string, message: string) => result.push({ code, message, field: 'integration', target: 'integration', severity: 'ERROR' });
    if (snapshot.environment === 'PRODUCTION') add('PRODUCTION_DISABLED', 'Emissão em produção ainda não disponível. Para testar, configure uma série padrão de homologação.');
    if (process.env.NFSE_HOMOLOGATION_ENABLED !== 'true') add('HOMOLOGATION_DISABLED', 'O envio em homologação ainda não está habilitado no servidor.');
    if (process.env.NFSE_CONTRACT_CONFIRMED !== 'true' || !['RSA_SHA1', 'RSA_SHA256'].includes(process.env.NFSE_SIGNATURE_PROFILE ?? '')) add('CONTRACT_PENDING', 'A configuração de comunicação e assinatura do ambiente nacional precisa ser concluída no servidor.');
    try {
      const raw = process.env.NFSE_SEFIN_HOMOLOGATION_URL;
      const endpoint = raw ? new URL(raw) : null;
      if (!endpoint || endpoint.protocol !== 'https:' || endpoint.hostname !== 'sefin.producaorestrita.nfse.gov.br' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.port && endpoint.port !== '443')) throw new Error();
    } catch { add('SEFIN_URL_PENDING', 'Configure a URL oficial da SEFIN de homologação no servidor.'); }
    if (!snapshot.certificate || snapshot.certificate.status !== 'ACTIVE') add('CERTIFICATE_REQUIRED', 'É necessário um certificado A1 válido da empresa para emitir.');
    else {
      try { await this.certificates.withSigningCredential(companyId, async () => undefined); }
      catch (error) { add('CERTIFICATE_NOT_TRUSTED', error instanceof Error ? error.message : 'Não foi possível verificar a confiança do certificado.'); }
    }
    return result;
  }

  async create(companyId: string, userId: string, saleId: string, key: string, input: NfsePreviewInput): Promise<NfsePreview> {
    const requestHash = hash(JSON.stringify({ saleId, input }));
    const [existing] = await this.database.db.select().from(nfsePreviews).where(and(eq(nfsePreviews.companyId, companyId), eq(nfsePreviews.requestKey, key))).limit(1);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ConflictException('Chave de prévia já usada com outros dados.');
      return this.get(companyId, existing.id);
    }
    const snapshot = await this.database.db.transaction(tx => this.build(companyId, saleId, input, tx), { isolationLevel: 'repeatable read' });
    const [row] = await this.database.db.insert(nfsePreviews).values({ companyId, saleId, saleVersion: snapshot.saleVersion, requestKey: key, requestHash, snapshotHash: snapshotHash(snapshot), snapshot: snapshot as unknown as Record<string, unknown>, createdByUserId: userId }).onConflictDoNothing({ target: [nfsePreviews.companyId, nfsePreviews.requestKey] }).returning({ id: nfsePreviews.id });
    if (!row) return this.create(companyId, userId, saleId, key, input);
    return this.get(companyId, row.id);
  }

  async get(companyId: string, id: string): Promise<NfsePreview> {
    const [row] = await this.database.db.select().from(nfsePreviews).where(and(eq(nfsePreviews.companyId, companyId), eq(nfsePreviews.id, id))).limit(1);
    if (!row) throw new NotFoundException('Prévia não encontrada.');
    const snapshot = row.snapshot as unknown as NfseSnapshot;
    const [sale] = await this.database.db.select({ version: sales.version }).from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, row.saleId))).limit(1);
    const emissionIssues = await this.emissionIssues(companyId, snapshot);
    const stale = sale?.version !== row.saleVersion;
    return { ...snapshot, id: row.id, hash: row.snapshotHash, stale, emissionIssues, canEmit: !stale && ![...snapshot.issues, ...emissionIssues].some(i => i.severity === 'ERROR') };
  }
}
