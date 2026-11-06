import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, BriefcaseBusiness, ChevronDown, ContactRound, Megaphone, X } from 'lucide-react';
import { api, ApiError, type CrmCreateResult, type CrmLeadInput, type Service } from '../../api/client';
import { normalizeMoney } from './crm-utils';
import { QuickServiceModal } from './QuickServiceModal';
import './proposals.css';

type FormState = {
  name: string; organizationName: string; phone: string; email: string; notes: string;
  description: string; serviceId: string; amount: string; expectedCloseOn: string;
  sourceLabel: string; utmSource: string; utmMedium: string; utmCampaign: string; utmContent: string;
};
const initial: FormState = { name: '', organizationName: '', phone: '', email: '', notes: '', description: '', serviceId: '', amount: '', expectedCloseOn: '', sourceLabel: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '' };
const nullable = (value: string) => value.trim() || null;

export function CrmLeadModal({ companyId, onClose, onCreated }: { companyId: string; onClose: () => void; onCreated: (result: CrmCreateResult) => void }) {
  const [form, setForm] = useState<FormState>(initial);
  const [showOrigin, setShowOrigin] = useState(false);
  const [validation, setValidation] = useState('');
  const [quickServiceOpen, setQuickServiceOpen] = useState(false);
  const [createdServices, setCreatedServices] = useState<Service[]>([]);
  const services = useQuery({ queryKey: ['crm-services', companyId], queryFn: () => api.services(companyId, { search: '', status: 'ACTIVE', page: 0, limit: 100 }) });
  const create = useMutation({ mutationFn: (input: CrmLeadInput) => api.createCrmLead(companyId, input, crypto.randomUUID()), onSuccess: onCreated });
  const busy = create.isPending;
  useEffect(() => {
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy && !quickServiceOpen) onClose(); };
    document.addEventListener('keydown', close);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', close); };
  }, [busy, onClose, quickServiceOpen]);
  const set = (key: keyof FormState, value: string) => { setForm((current) => ({ ...current, [key]: value })); setValidation(''); };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) { setValidation('Informe o nome do lead.'); return; }
    const estimatedAmount = normalizeMoney(form.amount);
    if (estimatedAmount === undefined) { setValidation('Informe um valor estimado válido.'); return; }
    const input: CrmLeadInput = {
      lead: { name: form.name.trim(), organizationName: nullable(form.organizationName), phone: nullable(form.phone), email: nullable(form.email)?.toLowerCase() ?? null, notes: nullable(form.notes) },
      interest: { description: nullable(form.description), primaryServiceId: form.serviceId || null, estimatedAmount, expectedCloseOn: form.expectedCloseOn || null },
      capture: { sourceLabel: nullable(form.sourceLabel), utmSource: nullable(form.utmSource), utmMedium: nullable(form.utmMedium), utmCampaign: nullable(form.utmCampaign), utmContent: nullable(form.utmContent) },
    };
    create.mutate(input);
  }
  return <div className="crm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="crm-modal crm-modal--create" role="dialog" aria-modal="true" aria-labelledby="crm-create-title">
      <header className="crm-modal__header"><div><span>NOVO CONTATO COMERCIAL</span><h2 id="crm-create-title">Adicionar lead</h2><p>O primeiro card será criado automaticamente em Novo lead.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20} /></button></header>
      <form onSubmit={submit}>
        <div className="crm-modal__body">
          <div className="crm-form-section"><div className="crm-form-section__heading"><ContactRound size={18} /><div><h3>Dados do contato</h3><p>Nome é o único campo necessário para começar.</p></div></div>
            <div className="crm-form-grid crm-form-grid--two"><label className="field"><span>Nome</span><input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nome da pessoa" maxLength={200} /></label><label className="field"><span>Empresa</span><input value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} placeholder="Empresa em que trabalha" maxLength={200} /></label><label className="field"><span>WhatsApp / telefone</span><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(00) 00000-0000" maxLength={64} /></label><label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="contato@empresa.com" maxLength={254} /></label></div>
          </div>
          <div className="crm-form-section"><div className="crm-form-section__heading"><BriefcaseBusiness size={18} /><div><h3>Negociação inicial</h3><p>O interesse fica ligado somente a este card.</p></div></div>
            <div className="crm-form-grid crm-form-grid--two"><div className="proposal-service-pick"><label className="field"><span>Serviço de interesse</span><select value={form.serviceId} onChange={(e) => set('serviceId', e.target.value)}><option value="">Ainda não definido</option>{[...createdServices, ...(services.data?.items ?? []).filter((service) => !createdServices.some((created) => created.id === service.id))].map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><button type="button" className="proposal-inline-new" onClick={() => setQuickServiceOpen(true)}>+ Novo</button></div><label className="field"><span>Valor estimado</span><input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" /></label><label className="field crm-field--wide"><span>Interesse ou necessidade</span><input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Implantação de CRM" maxLength={2000} /></label><label className="field"><span>Previsão de fechamento</span><input type="date" value={form.expectedCloseOn} onChange={(e) => set('expectedCloseOn', e.target.value)} /></label><label className="field crm-field--wide"><span>Observações do contato</span><textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Contexto importante para o próximo contato" maxLength={10000} /></label></div>
          </div>
          <div className="crm-origin"><button type="button" className="crm-origin__toggle" onClick={() => setShowOrigin((value) => !value)} aria-expanded={showOrigin}><Megaphone size={17} /><span><strong>Origem da captação</strong><small>Opcional · preserve a campanha deste lead</small></span><ChevronDown size={17} className={showOrigin ? 'is-open' : ''} /></button>{showOrigin && <div className="crm-origin__fields"><div className="crm-form-grid crm-form-grid--two"><label className="field"><span>Origem</span><input value={form.sourceLabel} onChange={(e) => set('sourceLabel', e.target.value)} placeholder="Ex.: Indicação" maxLength={120} /></label><label className="field"><span>UTM source</span><input value={form.utmSource} onChange={(e) => set('utmSource', e.target.value)} placeholder="instagram" maxLength={200} /></label><label className="field"><span>UTM medium</span><input value={form.utmMedium} onChange={(e) => set('utmMedium', e.target.value)} placeholder="paid_social" maxLength={200} /></label><label className="field"><span>UTM campaign</span><input value={form.utmCampaign} onChange={(e) => set('utmCampaign', e.target.value)} placeholder="campanha_outubro" maxLength={200} /></label><label className="field crm-field--wide"><span>UTM content</span><input value={form.utmContent} onChange={(e) => set('utmContent', e.target.value)} placeholder="criativo_video_01" maxLength={200} /></label></div></div>}</div>
          {(validation || create.isError) && <div className="crm-modal__error" role="alert"><AlertCircle size={16} />{validation || (create.error instanceof ApiError ? create.error.message : 'Não foi possível criar o lead.')}</div>}
        </div>
        <footer className="crm-modal__footer"><span>Contato, origem, card e histórico serão salvos juntos.</span><div><button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" className="button button--primary" disabled={busy}>{busy ? 'Adicionando...' : 'Adicionar lead'}</button></div></footer>
      </form>
    </section>
    {quickServiceOpen && <QuickServiceModal companyId={companyId} onClose={() => setQuickServiceOpen(false)} onCreated={(service) => { setCreatedServices((current) => [...current, service]); set('serviceId', service.id); setQuickServiceOpen(false); }} />}
  </div>;
}
