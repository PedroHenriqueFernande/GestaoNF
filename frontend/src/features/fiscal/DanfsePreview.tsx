import type { NfseGroup, NfseParty, NfsePreview } from '../../api/nfse.types';
import './danfse-preview.css';

const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const date = (value: string) => value.split('-').reverse().join('/');
const missing = '—';

function Field({ label, value }: { label: string; value?: string | null }) {
  return <div className="danfse-field"><span>{label}</span><strong>{value || missing}</strong></div>;
}

function Party({ title, party, simples }: { title: string; party: NfseParty; simples?: string | null }) {
  const address = [party.street, party.number, party.district].filter(Boolean).join(', ');
  return <section className="danfse-section"><h4>{title}</h4><div className="danfse-grid danfse-grid--party">
    <Field label="Nome / nome empresarial" value={party.name} />
    <Field label="CPF / CNPJ" value={party.taxId} />
    <Field label="Inscrição municipal" value={party.municipalRegistration} />
    <Field label="Endereço" value={address} />
    <Field label="Município / UF" value={[party.cityName, party.stateCode].filter(Boolean).join(' / ')} />
    <Field label="Código IBGE / CEP" value={[party.cityIbgeCode, party.postalCode].filter(Boolean).join(' / ')} />
    <Field label="E-mail" value={party.email} />
    {simples && <Field label="Simples Nacional" value={simples} />}
  </div></section>;
}

function Document({ preview, group, index }: { preview: NfsePreview; group: NfseGroup; index: number }) {
  const environment = preview.environment === 'HOMOLOGATION' ? 'Homologação' : preview.environment === 'PRODUCTION' ? 'Produção' : 'Não configurado';
  const regime = preview.simplesOption === '2' ? 'MEI / SIMEI' : preview.simplesOption === '3' ? 'ME/EPP no Simples Nacional' : null;
  return <article className="danfse-sheet" aria-label={`Prévia da NFS-e ${index + 1}`}>
    <div className="danfse-banner"><strong>PRÉ-VISUALIZAÇÃO — DOCUMENTO NÃO EMITIDO</strong><span>Sem validade fiscal ou jurídica · Sem chave de acesso e QR Code</span></div>
    <header className="danfse-header"><div className="danfse-wordmark">NFS<span>-e</span></div><div><strong>DANFSe v2.0</strong><span>Documento Auxiliar da NFS-e · modelo de prévia</span></div><div><small>Município: {preview.issuer.cityName || missing}</small><small>Ambiente da série: {environment}</small></div></header>
    <section className="danfse-section"><h4>Identificação da NFS-e</h4><div className="danfse-grid danfse-grid--identification">
      <Field label="Chave de acesso da NFS-e" value="Atribuída somente após autorização" />
      <Field label="Número da NFS-e" value="Não emitida" />
      <Field label="Competência" value={date(group.competence)} />
      <Field label="Data e hora de emissão da NFS-e" />
      <Field label="Número da DPS" value="Não reservado" />
      <Field label="Série da DPS" value={preview.series?.number.toString()} />
      <Field label="Emitente" value="Prestador" />
      <Field label="Situação" value="Prévia, sem autorização" />
      <Field label="Finalidade" value="Emissão normal prevista" />
    </div></section>
    <Party title="Prestador / fornecedor" party={preview.issuer} simples={regime} />
    <Party title="Tomador / adquirente" party={preview.customer} />
    <section className="danfse-section"><h4>Serviço prestado</h4><div className="danfse-grid danfse-grid--service">
      <Field label="Código de tributação nacional / municipal" value={[group.nationalTaxCode, group.municipalTaxCode].filter(Boolean).join(' / ')} />
      <Field label="Código NBS" value={group.nbsCode} />
      <Field label="Local da prestação · código IBGE" value={group.municipalityIbgeCode} />
    </div><div className="danfse-description"><span>Descrição do serviço</span><p>{group.description || missing}</p></div></section>
    <section className="danfse-section"><h4>Tributação municipal (ISSQN)</h4><div className="danfse-grid">
      <Field label="Tributação prevista" value="Operação sujeita ao ISSQN" />
      <Field label="Retenção do ISSQN" value={group.issWithholding ? 'Revisão necessária' : 'Não retido'} />
      <Field label="Base de cálculo / alíquota aplicada" value="Apuradas na autorização" />
      <Field label="ISSQN apurado" value="Apurado na autorização" />
    </div></section>
    <section className="danfse-section"><h4>Tributação federal e IBS/CBS</h4><p className="danfse-muted">Campos calculados e autorizados pelo ambiente nacional serão apresentados no documento fiscal emitido.</p></section>
    <section className="danfse-section"><h4>Valor total da NFS-e · prévia</h4><div className="danfse-grid danfse-grid--totals">
      <Field label="Valor da operação / serviço" value={money(group.grossAmount)} />
      <Field label="Desconto" value={money(group.discountAmount)} />
      <Field label="Valor previsto" value={money(group.totalAmount)} />
    </div></section>
    <section className="danfse-section"><h4>Informações complementares</h4><p className="danfse-muted">Pedido #{preview.orderCode}. {preview.input.simplesTotalTaxPercent ? `Total aproximado de tributos informado: ${preview.input.simplesTotalTaxPercent}%.` : 'Total aproximado de tributos ainda não informado.'} Os valores fiscais definitivos dependem da autorização.</p></section>
    <footer className="danfse-sheet__footer">Prévia {index + 1} de {preview.groups.length} · Gerada em {new Date(preview.generatedAt).toLocaleString('pt-BR')} · Nenhuma NFS-e foi emitida</footer>
  </article>;
}

export function DanfsePreview({ preview }: { preview: NfsePreview }) {
  return <div className="danfse-preview">{preview.groups.map((group, index) => <Document key={group.key} preview={preview} group={group} index={index} />)}{preview.groups.length > 1 && <p className="danfse-preview__aggregate">Total da venda: <strong>{money(preview.totalAmount)}</strong> · {preview.groups.length} documentos previstos</p>}</div>;
}
