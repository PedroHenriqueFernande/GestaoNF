import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertCircle, Calculator, Hash, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, type FiscalSeries, type TaxProfile, type TaxRevisionInput, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import './fiscal.css';

const today = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const blankRevision = (): TaxRevisionInput => ({ effectiveFrom: today(), issRatePercent: null, pisRatePercent: null,
  cofinsRatePercent: null, csllRatePercent: null, irRatePercent: null, inssRatePercent: null,
  issWithholdingSuggestion: null, notes: null });
const rateFields: Array<[keyof TaxRevisionInput, string]> = [
  ['issRatePercent', 'ISS (%)'], ['pisRatePercent', 'PIS (%)'], ['cofinsRatePercent', 'COFINS (%)'],
  ['csllRatePercent', 'CSLL (%)'], ['irRatePercent', 'IRRF (%)'], ['inssRatePercent', 'INSS (%)'],
];

export function FiscalPage({ user, mode }: { user: User; mode: 'series' | 'tax' }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [seriesForm, setSeriesForm] = useState({ environment: 'HOMOLOGATION' as FiscalSeries['environment'], seriesNumber: '1', nextNumber: '1', isDefault: true });
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [historySeriesId, setHistorySeriesId] = useState<string | null>(null);
  const [advanceNumber, setAdvanceNumber] = useState('');
  const [advanceReason, setAdvanceReason] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TaxProfile['scope']>('COMPANY');
  const [serviceId, setServiceId] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [revision, setRevision] = useState<TaxRevisionInput>(blankRevision);
  const [editingProfile, setEditingProfile] = useState<TaxProfile | null>(null);

  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  useEffect(() => { if (companies.data && !companies.data.some(row => row.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => { setError(''); setMessage(''); setEditingProfile(null); setAdvancing(null); setHistorySeriesId(null); }, [companyId, mode]);
  const company = companies.data?.find(row => row.id === companyId);
  const canManage = company?.role === 'OWNER' || company?.role === 'ADMIN';
  const profile = useQuery({ queryKey: ['company', companyId], queryFn: () => api.company(companyId), enabled: !!companyId });
  const series = useQuery({ queryKey: ['fiscal-series', companyId], queryFn: () => api.fiscalSeries(companyId), enabled: !!companyId && mode === 'series' });
  const adjustments = useQuery({ queryKey: ['fiscal-series-adjustments', companyId, historySeriesId],
    queryFn: () => api.fiscalSeriesAdjustments(companyId, historySeriesId!), enabled: !!companyId && !!historySeriesId && mode === 'series' });
  const rules = useQuery({ queryKey: ['fiscal-tax', companyId], queryFn: () => api.taxProfiles(companyId), enabled: !!companyId && mode === 'tax' });
  const services = useQuery({ queryKey: ['fiscal-services', companyId, serviceSearch], queryFn: () => api.services(companyId, { status: 'ACTIVE', search: serviceSearch, page: 0, limit: 100 }), enabled: !!companyId && mode === 'tax' });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/Clientes'); } });

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      await action();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['fiscal-series', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['fiscal-series-adjustments', companyId] }),
        queryClient.invalidateQueries({ queryKey: ['fiscal-tax', companyId] })]);
      setMessage(success);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { setBusy(false); }
  }

  function createSeries(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api.createFiscalSeries(companyId, { ...seriesForm, seriesNumber: Number(seriesForm.seriesNumber) });
      setSeriesForm(previous => ({ ...previous, seriesNumber: String(Number(previous.seriesNumber) + 1) }));
    }, 'Série cadastrada. O próximo número fica reservado para a futura emissão da nota.');
  }

  function saveRule(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (editingProfile) {
        await api.addTaxRevision(companyId, editingProfile.id, { ...revision, expectedVersion: editingProfile.version });
      } else {
        await api.createTaxProfile(companyId, { name: name.trim(), scope, serviceId: scope === 'COMPANY' ? null : serviceId,
          municipalityIbgeCode: scope === 'SERVICE_MUNICIPALITY' ? municipality : null, isDefault, revision });
      }
      setEditingProfile(null); setName(''); setRevision(blankRevision()); setScope('COMPANY'); setServiceId(''); setMunicipality('');
    }, editingProfile ? 'Nova revisão tributária registrada.' : 'Regra tributária cadastrada.');
  }

  function editRule(rule: TaxProfile) {
    const current = rule.revisions[0];
    const dayAfterCurrent = new Date(`${current.effectiveFrom}T00:00:00Z`);
    dayAfterCurrent.setUTCDate(dayAfterCurrent.getUTCDate() + 1);
    setEditingProfile(rule);
    setName(rule.name);
    setScope(rule.scope);
    setServiceId(rule.serviceId ?? '');
    setMunicipality(rule.municipalityIbgeCode ?? '');
    setRevision({ effectiveFrom: dayAfterCurrent.toISOString().slice(0, 10) > today() ? dayAfterCurrent.toISOString().slice(0, 10) : today(), issRatePercent: current.issRatePercent,
      pisRatePercent: current.pisRatePercent, cofinsRatePercent: current.cofinsRatePercent,
      csllRatePercent: current.csllRatePercent, irRatePercent: current.irRatePercent,
      inssRatePercent: current.inssRatePercent, issWithholdingSuggestion: current.issWithholdingSuggestion, notes: current.notes });
    document.getElementById('fiscal-rule-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={setCompanyId}
    onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="fiscal-workspace">
    <main id="workspace-main" className="fiscal-page" tabIndex={-1}>
      <header className="fiscal-heading"><div><span>FISCAL / CONFIGURAÇÕES</span><h1>{mode === 'series' ? 'Séries e numeração' : 'Controle de tributação'}</h1>
        <p>{mode === 'series' ? 'Organize a série e o próximo número da declaração de serviços.' : 'Salve sugestões de impostos para usar nas vendas de serviços.'}</p></div>
        <span className="fiscal-heading__icon">{mode === 'series' ? <Hash size={29} /> : <Calculator size={29} />}</span></header>
      <nav className="fiscal-tabs" aria-label="Seções fiscais"><Link to="/fiscal/series" aria-current={mode === 'series' ? 'page' : undefined}>Séries e numeração</Link><Link to="/fiscal/tributacao" aria-current={mode === 'tax' ? 'page' : undefined}>Controle de tributação</Link></nav>
      {error && <p className="fiscal-alert fiscal-alert--error" role="alert"><AlertCircle size={17} />{error}</p>}
      {message && <p className="fiscal-alert fiscal-alert--success" role="status"><ShieldCheck size={17} />{message}</p>}
      {mode === 'series' ? <>
        <div className="fiscal-note"><strong>Venda e nota têm números diferentes.</strong> Vincular uma série à venda não consome número da DPS. O contador será usado somente quando a emissão da NFS-e estiver disponível.</div>
        {canManage && <section className="fiscal-card"><h2><Plus size={18} /> Nova série</h2>
          <p>A empresa precisa ter CPF/CNPJ e município preenchidos. Use uma série exclusiva deste sistema.</p>
          <form className="fiscal-form" onSubmit={createSeries}>
            <label>Ambiente<select value={seriesForm.environment} onChange={event => setSeriesForm(value => ({ ...value, environment: event.target.value as FiscalSeries['environment'] }))}><option value="HOMOLOGATION">Homologação</option><option value="PRODUCTION">Produção</option></select></label>
            <label>Série<input type="number" min="1" max="49999" required value={seriesForm.seriesNumber} onChange={event => setSeriesForm(value => ({ ...value, seriesNumber: event.target.value }))} /></label>
            <label>Próximo número da DPS<input type="text" inputMode="numeric" pattern="[1-9][0-9]{0,14}" required value={seriesForm.nextNumber} onChange={event => setSeriesForm(value => ({ ...value, nextNumber: event.target.value }))} /></label>
            <label className="fiscal-check"><input type="checkbox" checked={seriesForm.isDefault} onChange={event => setSeriesForm(value => ({ ...value, isDefault: event.target.checked }))} />Usar como série padrão</label>
            <button className="button button--primary" disabled={busy || !profile.data?.taxId || !profile.data.cityIbgeCode}>Cadastrar série</button>
          </form>
          {profile.data && (!profile.data.taxId || !profile.data.cityIbgeCode) && <p className="fiscal-hint">Complete CPF/CNPJ e município em <Link to="/empresa">Empresa</Link> para cadastrar uma série.</p>}
        </section>}
        <section className="fiscal-card"><div className="fiscal-card__head"><h2>Séries cadastradas</h2><button type="button" onClick={() => series.refetch()} aria-label="Atualizar séries"><RefreshCw size={16} /></button></div>
          {series.isPending ? <p>Carregando séries...</p> : series.isError ? <p role="alert">Não foi possível carregar as séries.</p> : !series.data?.length ? <p>Nenhuma série cadastrada.</p> : <div className="fiscal-list">{series.data.map(row => <article className="fiscal-row" key={row.id}>
            <div><strong>Série {String(row.seriesNumber).padStart(5, '0')}</strong><span>{row.environment === 'PRODUCTION' ? 'Produção' : 'Homologação'} · {row.isDefault ? 'Padrão' : 'Opcional'} · {row.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</span><small>Próximo número: {row.nextNumber} · Início: {row.initialNumber} · Município {row.municipalityIbgeCode}</small></div>
            {canManage && <div className="fiscal-row__actions">
              {row.status === 'ACTIVE' && !row.isDefault && <button type="button" disabled={busy} onClick={() => void run(() => api.updateFiscalSeries(companyId, row.id, { expectedVersion: row.version, isDefault: true }), 'Série padrão atualizada.')}>Tornar padrão</button>}
              <button type="button" disabled={busy} onClick={() => void run(() => api.updateFiscalSeries(companyId, row.id, { expectedVersion: row.version, status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), 'Situação da série atualizada.')}>{row.status === 'ACTIVE' ? 'Inativar' : 'Ativar'}</button>
              <button type="button" disabled={busy} onClick={() => { setAdvancing(advancing === row.id ? null : row.id); setAdvanceNumber(''); setAdvanceReason(''); }}>Avançar número</button>
            </div>}
            <button type="button" className="fiscal-history-toggle" onClick={() => setHistorySeriesId(current => current === row.id ? null : row.id)}
              aria-expanded={historySeriesId === row.id}>Histórico da numeração</button>
            {historySeriesId === row.id && <div className="fiscal-history">
              {adjustments.isPending ? <p>Carregando histórico...</p> : adjustments.isError ? <p role="alert">Não foi possível carregar o histórico.</p> :
                !adjustments.data?.length ? <p>Nenhum avanço manual registrado.</p> : adjustments.data.map(entry =>
                  <p key={entry.id}><strong>{entry.oldNextNumber} → {entry.newNextNumber}</strong> · {entry.reason} · {entry.actorName} · {new Date(entry.createdAt).toLocaleString('pt-BR')}</p>)}
            </div>}
            {advancing === row.id && <form className="fiscal-advance" onSubmit={event => { event.preventDefault(); void run(async () => { await api.advanceFiscalSeries(companyId, row.id, { expectedVersion: row.version, nextNumber: advanceNumber, reason: advanceReason }); setAdvancing(null); }, 'Próximo número avançado com registro do motivo.'); }}>
              <label>Novo próximo número<input required inputMode="numeric" pattern="[1-9][0-9]{0,14}" value={advanceNumber} onChange={event => setAdvanceNumber(event.target.value)} /></label>
              <label>Motivo<input required minLength={5} maxLength={500} value={advanceReason} onChange={event => setAdvanceReason(event.target.value)} placeholder="Ex.: números usados em outro sistema" /></label>
              <button className="button button--primary" disabled={busy}>Confirmar avanço</button>
            </form>}
          </article>)}</div>}
        </section>
      </> : <>
        <div className="fiscal-note"><strong>Preenchimento sugerido.</strong> Os percentuais aplicados à venda ficam registrados nela. Na emissão, município, regime, retenções e dados oficiais precisarão ser conferidos.</div>
        {canManage && <section className="fiscal-card" id="fiscal-rule-form"><h2>{editingProfile ? `Nova revisão de ${editingProfile.name}` : 'Nova regra tributária'}</h2>
          <form className="fiscal-form fiscal-form--tax" onSubmit={saveRule}>
            {!editingProfile && <><label>Nome da regra<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Serviços da empresa" /></label>
              <label>Aplicar a<select value={scope} onChange={event => { setScope(event.target.value as TaxProfile['scope']); setServiceId(''); setMunicipality(''); }}><option value="COMPANY">Todos os serviços da empresa</option><option value="SERVICE">Um serviço</option><option value="SERVICE_MUNICIPALITY">Um serviço em um município</option></select></label>
              {scope !== 'COMPANY' && <label>Serviço<input value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Buscar serviço" /><select required value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Selecione</option>{services.data?.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
              {scope === 'SERVICE_MUNICIPALITY' && <label>Código IBGE do município<input required inputMode="numeric" pattern="[0-9]{7}" maxLength={7} value={municipality} onChange={event => setMunicipality(event.target.value)} /></label>}
              <label className="fiscal-check"><input type="checkbox" checked={isDefault} onChange={event => setIsDefault(event.target.checked)} />Aplicar automaticamente como padrão</label>
            </>}
            <label>Válida a partir de<input type="date" required value={revision.effectiveFrom} onChange={event => setRevision(value => ({ ...value, effectiveFrom: event.target.value }))} /></label>
            <div className="fiscal-form__rates">{rateFields.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max={key === 'issRatePercent' ? '5' : '100'} step="0.0001" value={revision[key] as string ?? ''} onChange={event => setRevision(value => ({ ...value, [key]: event.target.value || null }))} placeholder="Não sugerir" /></label>)}</div>
            <label>Retenção do ISS<select value={revision.issWithholdingSuggestion === null ? '' : revision.issWithholdingSuggestion ? 'yes' : 'no'} onChange={event => setRevision(value => ({ ...value, issWithholdingSuggestion: event.target.value === '' ? null : event.target.value === 'yes' }))}><option value="">Não sugerir</option><option value="yes">Sugerir ISS retido</option><option value="no">Sugerir sem retenção</option></select></label>
            <label>Observação<textarea maxLength={2000} rows={2} value={revision.notes ?? ''} onChange={event => setRevision(value => ({ ...value, notes: event.target.value || null }))} /></label>
            <div className="fiscal-form__actions">{editingProfile && <button type="button" className="button button--secondary" onClick={() => { setEditingProfile(null); setRevision(blankRevision()); }}>Cancelar revisão</button>}<button className="button button--primary" disabled={busy}>{editingProfile ? 'Salvar nova revisão' : 'Cadastrar regra'}</button></div>
          </form>
        </section>}
        <section className="fiscal-card"><div className="fiscal-card__head"><h2>Regras cadastradas</h2><button type="button" onClick={() => rules.refetch()} aria-label="Atualizar regras"><RefreshCw size={16} /></button></div>
          {rules.isPending ? <p>Carregando regras...</p> : rules.isError ? <p role="alert">Não foi possível carregar as regras.</p> : !rules.data?.length ? <p>Nenhuma regra tributária cadastrada.</p> : <div className="fiscal-list">{rules.data.map(row => <article className="fiscal-row" key={row.id}>
            <div><strong>{row.name}</strong><span>{row.scope === 'COMPANY' ? 'Empresa inteira' : row.scope === 'SERVICE' ? 'Serviço específico' : `Serviço no município ${row.municipalityIbgeCode}`} · {row.isDefault ? 'Padrão' : 'Manual'} · {row.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}</span>
              <small>Revisão {row.revisions[0]?.revision ?? '—'} · Vigente desde {row.revisions[0]?.effectiveFrom ?? '—'}</small>
              <div className="fiscal-rate-tags">{rateFields.flatMap(([key, label]) => row.revisions[0]?.[key] === null || row.revisions[0]?.[key] === undefined ? [] : [<span key={key}>{label} {row.revisions[0][key]}%</span>])}</div></div>
            {canManage && <div className="fiscal-row__actions"><button type="button" disabled={busy} onClick={() => editRule(row)}>Nova revisão</button>
              {row.status === 'ACTIVE' && !row.isDefault && <button type="button" disabled={busy} onClick={() => void run(() => api.updateTaxProfile(companyId, row.id, { expectedVersion: row.version, isDefault: true }), 'Regra padrão atualizada.')}>Tornar padrão</button>}
              <button type="button" disabled={busy} onClick={() => void run(() => api.updateTaxProfile(companyId, row.id, { expectedVersion: row.version, status: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }), 'Situação da regra atualizada.')}>{row.status === 'ACTIVE' ? 'Inativar' : 'Ativar'}</button></div>}
          </article>)}</div>}
        </section>
      </>}
    </main>
  </WorkspaceLayout>;
}
