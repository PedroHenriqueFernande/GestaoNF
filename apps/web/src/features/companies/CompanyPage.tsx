import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, ChevronRight, FileCheck2, MapPin, Plus, Save, UserRound, X } from 'lucide-react';
import { api, type CompanyInput, type CompanyProfile, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';

type FormState = Record<keyof CompanyInput, string>;
type FormKey = keyof FormState;
type Modal = { mode: 'create' } | { mode: 'edit'; companyId: string } | null;
const emptyForm: FormState = {
  name: '', kind: 'PJ', legalName: '', tradeName: '', taxId: '', email: '', phone: '',
  street: '', number: '', complement: '', district: '', postalCode: '', cityName: '',
  cityIbgeCode: '', stateCode: '', countryCode: 'BR', municipalRegistration: '',
  stateRegistration: '', cnaeCode: '', simplesNationalOption: '', simplesTaxationRegime: '', specialTaxRegime: '',
};

function toForm(company: CompanyProfile): FormState {
  return Object.fromEntries(Object.keys(emptyForm).map((key) => [key, String(company[key as FormKey] ?? '')])) as FormState;
}

function toInput(form: FormState): CompanyInput {
  const optional = (key: FormKey) => form[key].trim() || null;
  return {
    name: form.name.trim(), kind: form.kind as CompanyInput['kind'], legalName: optional('legalName'), tradeName: optional('tradeName'),
    taxId: optional('taxId')?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ?? null,
    email: optional('email'), phone: optional('phone'), street: optional('street'), number: optional('number'),
    complement: optional('complement'), district: optional('district'),
    postalCode: optional('postalCode')?.replace(/\D/g, '') ?? null,
    cityName: optional('cityName'), cityIbgeCode: optional('cityIbgeCode'), stateCode: optional('stateCode')?.toUpperCase() ?? null,
    countryCode: 'BR', municipalRegistration: optional('municipalRegistration'), stateRegistration: optional('stateRegistration'),
    cnaeCode: optional('cnaeCode')?.replace(/\D/g, '') ?? null,
    simplesNationalOption: optional('simplesNationalOption') as CompanyInput['simplesNationalOption'],
    simplesTaxationRegime: optional('simplesTaxationRegime') as CompanyInput['simplesTaxationRegime'],
    specialTaxRegime: optional('specialTaxRegime') as CompanyInput['specialTaxRegime'],
  };
}

export function CompanyPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [modal, setModal] = useState<Modal>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [toast, setToast] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const savePendingRef = useRef(false);
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });

  useEffect(() => {
    if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? '');
  }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const editingId = modal?.mode === 'edit' ? modal.companyId : '';
  const company = useQuery({ queryKey: ['company', editingId], queryFn: () => api.company(editingId), enabled: !!editingId });
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
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      if (target.mode === 'create') setCompanyId(result.id);
      setModal(null);
      setToast(target.mode === 'create' ? 'Empresa cadastrada com sucesso.' : 'Dados da empresa atualizados com sucesso.');
      save.reset();
    },
  });
  savePendingRef.current = save.isPending;
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/Clientes'); },
  });

  const editable = modal?.mode === 'create' || company.data?.role === 'OWNER' || company.data?.role === 'ADMIN';
  const set = (key: FormKey, value: string) => { setForm((current) => ({ ...current, [key]: value })); save.reset(); };
  const field = (key: FormKey, label: string, options: { placeholder?: string; required?: boolean; type?: string; hint?: string } = {}) =>
    <label className="field" key={key}><span>{label}{options.required && <b> *</b>}</span>
      <input value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder={options.placeholder} required={options.required} type={options.type ?? 'text'} disabled={!editable || save.isPending} />
      {options.hint && <small className="field-hint">{options.hint}</small>}
    </label>;
  const select = (key: FormKey, label: string, options: [string, string][]) =>
    <label className="field" key={key}><span>{label}</span><select value={form[key]} onChange={(event) => {
      if (key === 'simplesNationalOption') setForm((current) => ({ ...current, simplesNationalOption: event.target.value, simplesTaxationRegime: event.target.value === '3' ? current.simplesTaxationRegime : '' }));
      else set(key, event.target.value);
      save.reset();
    }} disabled={!editable || save.isPending || (key === 'simplesTaxationRegime' && form.simplesNationalOption !== '3')}>
      <option value="">Não informado</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal) save.mutate({ input: toInput(form), target: modal });
  }
  function newCompany(opener: HTMLElement) { openerRef.current = opener; setModal({ mode: 'create' }); setForm(emptyForm); save.reset(); setToast(''); }
  function openCompany(id: string, opener: HTMLElement) { openerRef.current = opener; setModal({ mode: 'edit', companyId: id }); setForm(emptyForm); save.reset(); setToast(''); }
  function closeModal() { if (!save.isPending) { setModal(null); save.reset(); } }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={(id) => { setCompanyId(id); setToast(''); }} onLogout={() => logout.mutate()} loggingOut={logout.isPending}>
    <main id="workspace-main" className="client-workspace__main company-main" tabIndex={-1}>
      <section className="client-panel company-list-panel" aria-labelledby="company-panel-title">
        <div className="client-panel__title"><h1 id="company-panel-title">Empresas</h1></div>
        <div className="client-panel__rule" />
        <div className="client-panel__actions company-list-panel__toolbar"><span>Cadastros vinculados ao seu usuário</span><button type="button" className="client-new-button" onClick={(event) => newCompany(event.currentTarget)}><Plus size={16} /> Novo</button></div>
        <div className="client-results company-list" aria-live="polite">
          <div className="client-results__heading"><h2>Empresas cadastradas</h2><span>{companies.data?.length ?? 0} {(companies.data?.length ?? 0) === 1 ? 'empresa' : 'empresas'}</span></div>
          {companies.isPending && <div className="table-loading" aria-label="Carregando empresas"><div /><div /><div /></div>}
          {companies.isError && <div className="company-list__message" role="alert"><AlertCircle size={18} /> Não foi possível carregar as empresas. <button type="button" onClick={() => companies.refetch()}>Tentar novamente</button></div>}
          {companies.isSuccess && companies.data.length === 0 && <div className="client-results__empty"><Building2 size={23} /><p>Nenhuma empresa cadastrada.</p><span>Use o botão Novo para adicionar sua primeira empresa.</span></div>}
          {companies.isSuccess && companies.data.length > 0 && <>
            <div className="company-list__head"><span>EMPRESA</span><span>SEU ACESSO</span><span>AÇÃO</span></div>
            {companies.data.map((item) => <button key={item.id} type="button" className={`company-list__item${item.id === companyId ? ' is-current' : ''}`} onClick={(event) => openCompany(item.id, event.currentTarget)} aria-label={`Abrir cadastro de ${item.name}`}>
              <span className="company-list__identity"><strong>{item.name}</strong><small>{item.id === companyId ? 'Empresa selecionada' : 'Clique para abrir o cadastro'}</small></span>
              <span className="company-list__role">{item.role === 'OWNER' ? 'Proprietário' : item.role === 'ADMIN' ? 'Administrador' : item.role === 'MANAGER' ? 'Gerente' : 'Colaborador'}</span>
              <span className="company-list__action">Abrir cadastro <ChevronRight size={16} /></span>
            </button>)}
          </>}
        </div>
      </section>
    </main>

    {modal && <div className="modal-backdrop company-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      <div ref={dialogRef} className="company-modal" role="dialog" aria-modal="true" aria-labelledby="company-modal-title">
        <header className="company-modal__header"><div><span>CADASTRO DA EMPRESA</span><h2 id="company-modal-title">{modal.mode === 'create' ? 'Nova empresa' : companies.data?.find((item) => item.id === editingId)?.name ?? 'Empresa'}</h2><p>{modal.mode === 'create' ? 'Preencha os dados da nova empresa.' : 'Consulte ou atualize os dados da empresa.'}</p></div><button type="button" className="company-modal__close" onClick={closeModal} aria-label="Fechar cadastro" disabled={save.isPending}><X size={19} /></button></header>
        {modal.mode === 'edit' && company.isPending && <div className="company-modal__message">Carregando dados da empresa...</div>}
        {modal.mode === 'edit' && company.isError && <div className="company-modal__message" role="alert"><AlertCircle size={18} /> Não foi possível carregar os dados. <button type="button" onClick={() => company.refetch()}>Tentar novamente</button></div>}
        {(modal.mode === 'create' || company.isSuccess) && <form className="company-form" onSubmit={submit}>
        <div className="company-form__scroll">
        <div className="company-form__intro"><div className="company-form__mark"><Building2 size={22} /></div><div><strong>{modal.mode === 'create' ? 'Cadastrar empresa' : company.data?.name}</strong><span>{modal.mode === 'create' ? 'A empresa será vinculada ao seu usuário como proprietário.' : `ID da empresa: ${editingId}`}</span></div><span className="company-form__status">{modal.mode === 'create' ? 'NOVA' : 'ATIVA'}</span></div>
        {!editable && <div className="company-form__readonly">Você tem acesso de consulta. Apenas proprietário ou administrador pode alterar estes dados.</div>}
        <section className="company-form__section"><div className="company-form__section-title"><UserRound size={19} /><div><h2>Identificação</h2><p>Identidade e contato da empresa</p></div></div>
          <div className="company-form__grid company-form__grid--two">
            {field('name', 'Nome de exibição', { required: true, placeholder: 'Como a empresa aparecerá no sistema' })}
            <label className="field"><span>Tipo de prestadora</span><select value={form.kind} onChange={(event) => { setForm((current) => ({ ...current, kind: event.target.value, taxId: '', tradeName: event.target.value === 'PF' ? '' : current.tradeName })); save.reset(); }} disabled={!editable || save.isPending}><option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option></select></label>
            {field('legalName', form.kind === 'PF' ? 'Nome civil' : 'Razão social', { placeholder: 'Nome legal da prestadora' })}
            {form.kind === 'PJ' && field('tradeName', 'Nome fantasia', { placeholder: 'Nome comercial da empresa' })}
            <label className="field"><span>{form.kind === 'PF' ? 'CPF' : 'CNPJ'}</span><input value={form.taxId} onChange={(event) => set('taxId', event.target.value)} placeholder={form.kind === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} disabled={!editable || save.isPending} /><small className="field-hint">Opcional no cadastro; quando informado, validamos o número.</small></label>
            {field('email', 'E-mail', { type: 'email', placeholder: 'contato@empresa.com.br' })}
            {field('phone', 'Telefone / WhatsApp', { placeholder: '(00) 00000-0000' })}
          </div>
        </section>
        <section className="company-form__section"><div className="company-form__section-title"><MapPin size={19} /><div><h2>Endereço</h2><p>Localização e município da prestadora</p></div></div>
          <div className="company-form__grid company-form__grid--address">
            {field('postalCode', 'CEP', { placeholder: '00000-000' })}{field('street', 'Logradouro', { placeholder: 'Rua, avenida...' })}
            {field('number', 'Número')}{field('complement', 'Complemento')}{field('district', 'Bairro')}
            {field('cityName', 'Cidade')}{field('stateCode', 'UF', { placeholder: 'SP' })}{field('cityIbgeCode', 'Código IBGE do município', { placeholder: '7 dígitos' })}
          </div>
        </section>
        <section className="company-form__section"><div className="company-form__section-title"><FileCheck2 size={19} /><div><h2>Dados fiscais</h2><p>Informações da prestadora para futura emissão de NFS-e</p></div></div>
          <div className="company-form__grid company-form__grid--two">
            {field('municipalRegistration', 'Inscrição municipal', { hint: 'Preencha quando aplicável ao seu município.' })}
            {field('stateRegistration', 'Inscrição estadual', { hint: 'Usada quando houver operações sujeitas à inscrição estadual.' })}
            {field('cnaeCode', 'CNAE principal', { placeholder: '7 dígitos' })}
            {select('simplesNationalOption', 'Opção pelo Simples Nacional', [['1', '1 — Não optante'], ['2', '2 — MEI'], ['3', '3 — ME/EPP'], ['4', '4 — Optante pendente']])}
            {select('simplesTaxationRegime', 'Regime de apuração no Simples', [['1', '1 — Federais e ISS pelo Simples'], ['2', '2 — Federais pelo Simples; ISS fora'], ['3', '3 — Federais e ISS fora do Simples']])}
            {select('specialTaxRegime', 'Regime especial de tributação', [['0', '0 — Nenhum'], ['1', '1 — Ato cooperado'], ['2', '2 — Estimativa'], ['3', '3 — Microempresa municipal'], ['4', '4 — Notário ou registrador'], ['5', '5 — Profissional autônomo'], ['6', '6 — Sociedade de profissionais']])}
          </div>
          <p className="company-form__hint">Preencher o cadastro não habilita automaticamente a emissão. As exigências fiscais serão conferidas ao emitir a nota.</p>
        </section>
        {save.isError && <div className="inline-error" role="alert">{save.error instanceof Error ? save.error.message : 'Não foi possível salvar a empresa.'}</div>}
        </div>
        <div className="company-form__footer"><span>{modal.mode === 'create' ? 'Clientes e serviços serão independentes por empresa.' : company.data ? `Atualizado em ${new Intl.DateTimeFormat('pt-BR').format(new Date(company.data.updatedAt))}` : ''}</span><div className="company-form__footer-actions"><button className="button button--secondary" type="button" onClick={closeModal} disabled={save.isPending}>Fechar</button>{editable && <button className="button button--primary" type="submit" disabled={save.isPending}><Save size={16} /> {save.isPending ? 'Salvando...' : modal.mode === 'create' ? 'Cadastrar empresa' : 'Salvar alterações'}</button>}</div></div>
      </form>}
      </div>
    </div>}
    {toast && <div className="action-toast action-toast--success" role="status"><div className="action-toast__body"><strong>Concluído</strong><span>{toast}</span></div></div>}
  </WorkspaceLayout>;
}
