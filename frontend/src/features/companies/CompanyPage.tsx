import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, ChevronRight, FileBadge, Plus, Save, X } from 'lucide-react';
import { PERMISSION_DENIED_MESSAGE } from '@gestaonf/permissions';
import { api, type Company, type CompanyInput, type CompanyProfile, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { CountryOptions } from '../../components/CountryOptions';
import { StateOptions } from '../../components/StateOptions';
import { CompanyLogo } from '../../components/CompanyLogo';
import { companyRoleOf } from '../../utils/format';
import { lookupBrazilianAddress } from '../../utils/cep';
import { usePermissions } from '../permissions/usePermissions';
import { CompanyLogoField, type LogoSelection } from './CompanyLogoField';
import { CERTIFICATE_MUTATION_KEY, CompanyCertificateControl } from './CompanyCertificateControl';

type FormState = Record<keyof CompanyInput, string>;
type FormKey = keyof FormState;
type Modal = { mode: 'create' } | { mode: 'edit'; companyId: string } | null;
const emptyForm: FormState = {
  tradeName: '', legalName: '', taxId: '', email: '', phone: '',
  street: '', number: '', complement: '', district: '', postalCode: '', cityName: '',
  cityIbgeCode: '', stateCode: '', countryCode: 'BR', municipalRegistration: '',
  simplesNationalOption: '',
  simplesIbsCbsRegime: '',
};

function toForm(company: CompanyProfile): FormState {
  return Object.fromEntries(Object.keys(emptyForm).map((key) => [key, String(company[key as FormKey] ?? '')])) as FormState;
}

function toInput(form: FormState): CompanyInput {
  const optional = (key: FormKey) => form[key].trim() || null;
  return {
    tradeName: form.tradeName.trim(), legalName: optional('legalName'),
    taxId: optional('taxId')?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ?? null,
    email: optional('email'), phone: optional('phone'), street: optional('street'), number: optional('number'),
    complement: optional('complement'), district: optional('district'),
    postalCode: optional('postalCode')?.replace(/\D/g, '') ?? null,
    cityName: optional('cityName'), cityIbgeCode: optional('cityIbgeCode'), stateCode: optional('stateCode')?.toUpperCase() ?? null,
    countryCode: form.countryCode, municipalRegistration: optional('municipalRegistration'),
    simplesNationalOption: optional('simplesNationalOption') as CompanyInput['simplesNationalOption'],
    simplesIbsCbsRegime: optional('simplesIbsCbsRegime') as CompanyInput['simplesIbsCbsRegime'],
  };
}

export function CompanyPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [modal, setModal] = useState<Modal>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [postalFeedback, setPostalFeedback] = useState('');
  const [postalSubmitting, setPostalSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [logoSelection, setLogoSelection] = useState<LogoSelection | null>(null);
  const [autoLogo, setAutoLogo] = useState<LogoSelection | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const savePendingRef = useRef(false);
  const postalLookupVersion = useRef(0);
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });

  useEffect(() => {
    if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? '');
  }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); else sessionStorage.removeItem('gestaonf.companyId'); }, [companyId]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const editingId = modal?.mode === 'edit' ? modal.companyId : '';
  const access = usePermissions(editingId);
  const company = useQuery({ queryKey: ['company', editingId], queryFn: () => api.company(editingId), enabled: !!editingId });
  const certificate = useQuery({ queryKey: ['fiscal-certificate', editingId], queryFn: () => api.fiscalCertificate(editingId), enabled: !!editingId });
  useEffect(() => { if (company.data && editingId) setForm(toForm(company.data)); }, [company.data, editingId]);

  useEffect(() => {
    if (!modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLButtonElement>('.company-modal__close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savePendingRef.current) { setModal(null); return; }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); openerRef.current?.focus(); };
  }, [modal]);

  const save = useMutation({
    mutationFn: ({ input, target }: { input: CompanyInput; target: Exclude<Modal, null> }) => target.mode === 'create' ? api.createCompany(input) : api.updateCompany(target.companyId, input),
    onSuccess: async (result, { target }) => {
      queryClient.setQueryData(['company', result.id], result);
      if (target.mode === 'edit') {
        queryClient.setQueryData<Company[]>(['companies'], (previous) => previous?.map((item) =>
          item.id === result.id ? { ...item, tradeName: result.tradeName, logoId: result.logoId } : item));
      }
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      if (target.mode === 'create') setCompanyId(result.id);
      if (target.mode === 'create' && logoSelection) {
        // A foto escolhida no cadastro sobe logo após criar; o modal continua aberto, agora em edição.
        setAutoLogo(logoSelection);
        setLogoSelection(null);
        setModal({ mode: 'edit', companyId: result.id });
        setToast('Empresa cadastrada com sucesso.');
        save.reset();
        return;
      }
      setModal(null);
      setToast(target.mode === 'create' ? 'Empresa cadastrada com sucesso.' : 'Dados da empresa atualizados com sucesso.');
      save.reset();
    },
  });
  const certificateBusy = useIsMutating({ mutationKey: CERTIFICATE_MUTATION_KEY }) > 0;
  savePendingRef.current = save.isPending || postalSubmitting || certificateBusy;
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/Clientes'); },
  });

  const editable = modal?.mode === 'create' || access.can('company.edit');
  const canCertificate = modal?.mode === 'edit' && access.can('company.certificate');
  /** Criar empresa usa a conta do próprio usuário: só no onboarding ou para quem é titular de alguma conta. */
  const canCreate = companies.isSuccess && (companies.data.length === 0 || companies.data.some((item) => item.accountOwner));
  const set = (key: FormKey, value: string) => {
    if (['postalCode', 'cityName', 'stateCode', 'countryCode'].includes(key)) {
      postalLookupVersion.current += 1;
      setPostalFeedback('');
    }
    setForm((current) => ({ ...current, [key]: value,
      ...(['postalCode', 'cityName', 'stateCode', 'countryCode'].includes(key) ? { cityIbgeCode: '' } : {}),
    }));
    save.reset();
  };

  async function resolvePostalCode(current: FormState): Promise<FormState> {
    const postalCode = current.postalCode.replace(/\D/g, '');
    if (current.countryCode !== 'BR' || !/^\d{8}$/.test(postalCode) || current.cityIbgeCode) return current;
    const version = ++postalLookupVersion.current;
    setPostalFeedback('Consultando CEP...');
    try {
      const address = await lookupBrazilianAddress(postalCode);
      if (version !== postalLookupVersion.current || form.postalCode.replace(/\D/g, '') !== postalCode || form.countryCode !== 'BR') return current;
      if (!address) { setPostalFeedback('CEP não encontrado. Confira o número informado.'); return current; }
      const next = { ...current, street: address.street || current.street, district: address.district || current.district,
        cityName: address.cityName, stateCode: address.stateCode, cityIbgeCode: address.cityIbgeCode };
      setForm((latest) => latest.postalCode.replace(/\D/g, '') === postalCode && latest.countryCode === 'BR'
        ? { ...latest, street: next.street, district: next.district, cityName: next.cityName, stateCode: next.stateCode, cityIbgeCode: next.cityIbgeCode }
        : latest);
      setPostalFeedback('Endereço encontrado pelo CEP. Informe o número do imóvel.');
      return next;
    } catch {
      if (version === postalLookupVersion.current) setPostalFeedback('Não foi possível consultar o CEP agora.');
      return current;
    }
  }
  const field = (key: FormKey, label: string, options: { placeholder?: string; required?: boolean; type?: string; hint?: string; wide?: boolean } = {}) =>
    <label className={`field${options.wide ? ' field--wide' : ''}`} key={key}><span>{label}{options.required && <b> *</b>}</span>
      <input value={form[key]} onChange={(event) => set(key, event.target.value)} onBlur={key === 'postalCode' ? () => { void resolvePostalCode(form); } : undefined} placeholder={options.placeholder} required={options.required} type={options.type ?? 'text'} disabled={!editable || save.isPending} />
      {(key === 'postalCode' ? postalFeedback : options.hint) && <small className="field-hint">{key === 'postalCode' ? postalFeedback : options.hint}</small>}
    </label>;
  const select = (key: FormKey, label: ReactNode, options: [string, string][], hint?: string, wide = false) =>
    <label className={`field${wide ? ' field--wide' : ''}`} key={key}><span>{label}</span><select value={form[key]} onChange={(event) => {
      if (key === 'simplesNationalOption') setForm((current) => ({ ...current, simplesNationalOption: event.target.value, simplesIbsCbsRegime: ['3', '4'].includes(event.target.value) ? current.simplesIbsCbsRegime : '' }));
      else set(key, event.target.value);
      save.reset();
    }} disabled={!editable || save.isPending || (key === 'simplesIbsCbsRegime' && !['3', '4'].includes(form.simplesNationalOption))}>
      <option value="">Não informado</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>{hint && <small className="field-hint">{hint}</small>}</label>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal || postalSubmitting) return;
    setPostalSubmitting(true);
    const target = modal;
    try { save.mutate({ input: toInput(await resolvePostalCode(form)), target }); }
    finally { setPostalSubmitting(false); }
  }
  function newCompany(opener: HTMLElement) { postalLookupVersion.current += 1; setPostalFeedback(''); openerRef.current = opener; setModal({ mode: 'create' }); setForm(emptyForm); setLogoSelection(null); setAutoLogo(null); save.reset(); setToast(''); }
  function openCompany(id: string, opener: HTMLElement) { postalLookupVersion.current += 1; setPostalFeedback(''); openerRef.current = opener; setModal({ mode: 'edit', companyId: id }); setForm(emptyForm); setLogoSelection(null); setAutoLogo(null); save.reset(); setToast(''); }
  function closeModal() { if (!savePendingRef.current) { postalLookupVersion.current += 1; setModal(null); setLogoSelection(null); setAutoLogo(null); save.reset(); } }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onboarding={companies.data?.length === 0} onCompanyChange={(id) => { setCompanyId(id); setToast(''); }} onLogout={() => logout.mutate()} loggingOut={logout.isPending}>
    <main id="workspace-main" className="client-workspace__main company-main" tabIndex={-1}>
      <section className="client-panel company-list-panel" aria-labelledby="company-panel-title">
        <div className="client-panel__title"><h1 id="company-panel-title">Empresas</h1></div>
        <div className="client-panel__rule" />
        <div className="client-panel__actions company-list-panel__toolbar"><span>Cadastros vinculados ao seu usuário</span>{canCreate && <button type="button" className="client-new-button" onClick={(event) => newCompany(event.currentTarget)}><Plus size={16} /> Novo</button>}</div>
        <div className="client-results company-list" aria-live="polite">
          <div className="client-results__heading"><h2>Empresas cadastradas</h2><span>{companies.data?.length ?? 0} {(companies.data?.length ?? 0) === 1 ? 'empresa' : 'empresas'}</span></div>
          {companies.isPending && <div className="table-loading" aria-label="Carregando empresas"><div /><div /><div /></div>}
          {companies.isError && <div className="company-list__message" role="alert"><AlertCircle size={18} /> Não foi possível carregar as empresas. <button type="button" onClick={() => companies.refetch()}>Tentar novamente</button></div>}
          {companies.isSuccess && companies.data.length === 0 && <div className="client-results__empty company-onboarding"><Building2 size={25} /><p>Cadastre sua primeira empresa</p><span>Esse cadastro é necessário para acessar Clientes, Serviços e as demais funcionalidades.</span><button type="button" className="button button--primary" onClick={(event) => newCompany(event.currentTarget)}><Plus size={15} /> Criar empresa</button></div>}
          {companies.isSuccess && companies.data.length > 0 && <>
            <div className="company-list__head"><span>EMPRESA</span><span>SEU ACESSO</span><span>AÇÃO</span></div>
            {companies.data.map((item) => <button key={item.id} type="button" className={`company-list__item${item.id === companyId ? ' is-current' : ''}`} onClick={(event) => openCompany(item.id, event.currentTarget)} aria-label={`Abrir cadastro de ${item.tradeName}`}>
              <span className="company-list__identity-row"><CompanyLogo company={item} className="company-list__logo" /><span className="company-list__identity"><strong>{item.tradeName}</strong><small>{item.id === companyId ? 'Empresa selecionada' : 'Clique para abrir o cadastro'}</small></span></span>
              <span className="company-list__role">{companyRoleOf(item)}</span>
              <span className="company-list__action">Abrir cadastro <ChevronRight size={16} /></span>
            </button>)}
          </>}
        </div>
      </section>
    </main>

    {modal && <div className="modal-backdrop company-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      <div ref={dialogRef} className="company-modal" role="dialog" aria-modal="true" aria-label={modal.mode === 'create' ? 'Nova empresa' : `Cadastro de ${companies.data?.find((item) => item.id === editingId)?.tradeName ?? 'empresa'}`}>
        <header className="company-modal__header"><div><span>{modal.mode === 'create' ? 'NOVA EMPRESA' : 'CADASTRO DA EMPRESA'}</span></div><button type="button" className="company-modal__close" onClick={closeModal} aria-label="Fechar cadastro" disabled={save.isPending || postalSubmitting}><X size={19} /></button></header>
        {modal.mode === 'edit' && company.isPending && <div className="company-modal__message">Carregando dados da empresa...</div>}
        {modal.mode === 'edit' && company.isError && <div className="company-modal__message" role="alert"><AlertCircle size={18} /> Não foi possível carregar os dados. <button type="button" onClick={() => company.refetch()}>Tentar novamente</button></div>}
        {(modal.mode === 'create' || company.isSuccess) && <form className="company-form" onSubmit={submit}>
        <div className="company-form__scroll">
        {!editable && <div className="company-form__readonly">{PERMISSION_DENIED_MESSAGE}</div>}
        <section className="company-form__section company-form__section--single"><div className="company-form__logo-row">{modal.mode === 'create'
            ? <CompanyLogoField mode="create" pending={logoSelection} onPendingChange={setLogoSelection}><span className="company-form__logo-label">Foto da empresa</span></CompanyLogoField>
            : <CompanyLogoField key={editingId} mode="edit" company={companies.data?.find((item) => item.id === editingId)} editable={editable} initialSelection={autoLogo}><span className="company-form__logo-label">Foto da empresa</span></CompanyLogoField>}
            {modal.mode === 'edit'
              ? <CompanyCertificateControl companyId={editingId} savedTaxId={company.data?.taxId} formTaxId={form.taxId} canManage={canCertificate} onDone={setToast} />
              : <div className="company-certificate-control"><button type="button" className="button button--secondary company-certificate-shortcut" disabled><FileBadge size={16} aria-hidden="true" /><span>Adicionar certificado</span></button><p className="company-certificate-control__hint">Salve a empresa para adicionar o certificado.</p></div>}</div>
          {/* Grade de 3 colunas: códigos curtos ocupam 1 coluna e textos longos ocupam 2. */}
          <div className="company-form__grid company-form__grid--three">
            {field('tradeName', 'Nome fantasia', { required: true, placeholder: 'Como a empresa aparecerá no sistema', hint: 'É o nome exibido no sistema.', wide: true })}
            <label className="field"><span>CNPJ</span><input value={form.taxId} onChange={(event) => set('taxId', event.target.value)} placeholder="00.000.000/0000-00" disabled={!editable || save.isPending || !!certificate.data} />{certificate.data && <small className="field-hint">Para alterar, desative primeiro o certificado.</small>}</label>
            {field('legalName', 'Razão social', { placeholder: 'Nome legal da empresa', wide: true })}
            {select('simplesNationalOption', 'Opção pelo Simples Nacional', [['1', '1 - Não optante'], ['2', '2 - MEI'], ['3', '3 - ME/EPP'], ['4', '4 - Optante pendente']])}
            {field('email', 'E-mail', { type: 'email', placeholder: 'contato@empresa.com.br', wide: true })}
            {field('phone', 'Telefone / WhatsApp', { placeholder: '(00) 00000-0000' })}
            {field('municipalRegistration', 'Inscrição municipal', { placeholder: 'Número da inscrição', hint: form.simplesNationalOption === '2' ? 'O MEI não precisa informar a inscrição na nota.' : undefined })}
            {select('simplesIbsCbsRegime', <>Como apura os novos impostos (IBS e CBS)<small className="field-optional">Opcional para emissão</small></>, [['1', 'Ambos pelo Simples Nacional'], ['2', 'CBS pelo Simples; IBS pelo regime regular'], ['3', 'Ambos pelo regime regular']], undefined, true)}
            {field('postalCode', 'CEP', { placeholder: '00000-000' })}
            {field('street', 'Logradouro', { placeholder: 'Rua, avenida...', wide: true })}
            {field('number', 'Número')}{field('complement', 'Complemento')}{field('district', 'Bairro')}
            {field('cityName', 'Cidade')}
            <label className="field"><span>UF</span><select aria-label="UF" value={form.stateCode} onChange={(event) => set('stateCode', event.target.value)} disabled={!editable || save.isPending}><StateOptions value={form.stateCode} /></select></label>
            <label className="field"><span>País</span><select value={form.countryCode} onChange={(event) => set('countryCode', event.target.value)} disabled={!editable || save.isPending}><CountryOptions value={form.countryCode} /></select></label>
          </div>
        </section>
        {save.isError && <div className="inline-error" role="alert">{save.error instanceof Error ? save.error.message : 'Não foi possível salvar a empresa.'}</div>}
        </div>
        <div className="company-form__footer"><span>{modal.mode === 'create' ? 'Clientes e serviços serão independentes por empresa.' : company.data ? `Atualizado em ${new Intl.DateTimeFormat('pt-BR').format(new Date(company.data.updatedAt))}` : ''}</span><div className="company-form__footer-actions"><button className="button button--secondary" type="button" onClick={closeModal} disabled={save.isPending || postalSubmitting}>Fechar</button>{editable && <button className="button button--primary" type="submit" disabled={save.isPending || postalSubmitting}><Save size={16} /> {save.isPending ? 'Salvando...' : postalSubmitting ? 'Consultando CEP...' : modal.mode === 'create' ? 'Cadastrar empresa' : 'Salvar alterações'}</button>}</div></div>
      </form>}
      </div>
    </div>}
    {toast && <div className="action-toast action-toast--success" role="status"><div className="action-toast__body"><strong>Concluído</strong><span>{toast}</span></div></div>}
  </WorkspaceLayout>;
}
