import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, Megaphone } from 'lucide-react';
import { api, ApiError, type CrmCreateResult, type CrmLeadInput, type Service } from '../../api/client';
import { RegistrationDialog } from '../../components/RegistrationDialog';
import { SaleDropdown } from '../sales/SaleDropdown';
import { ServiceCreateModal } from '../services/ServiceCreateModal';
import { usePermissions } from '../permissions/usePermissions';
import { CompanyField, type CompanyChoice } from './CompanyField';
import './proposals.css';

type FormState = {
  name: string; organizationName: string; phone: string; email: string; notes: string;
  serviceId: string;
  sourceLabel: string; utmSource: string; utmMedium: string; utmCampaign: string; utmContent: string;
};
const initial: FormState = { name: '', organizationName: '', phone: '', email: '', notes: '', serviceId: '', sourceLabel: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '' };
const nullable = (value: string) => value.trim() || null;

export function CrmLeadModal({ companyId, companyChoice, onClose, onCreated }: { companyId: string; companyChoice?: CompanyChoice; onClose: () => void; onCreated: (result: CrmCreateResult) => void }) {
  const [form, setForm] = useState<FormState>(initial);
  const [showOrigin, setShowOrigin] = useState(false);
  const [validation, setValidation] = useState('');
  const [quickServiceOpen, setQuickServiceOpen] = useState(false);
  const [createdServices, setCreatedServices] = useState<Service[]>([]);
  const quickServiceTrigger = useRef<HTMLButtonElement>(null);
  const access = usePermissions(companyId);
  const canReadServices = access.can('services.access');
  const canCreateService = access.can('services.create');
  const services = useQuery({ queryKey: ['crm-services', companyId], queryFn: () => api.services(companyId, { search: '', status: 'ACTIVE', page: 0, limit: 100 }), enabled: !!companyId && canReadServices });
  const serviceOptions = [
    ...createdServices,
    ...(services.data?.items ?? []).filter((service) => !createdServices.some((created) => created.id === service.id)),
  ];
  const create = useMutation({ mutationFn: (input: CrmLeadInput) => api.createCrmLead(companyId, input, crypto.randomUUID()), onSuccess: onCreated });
  const busy = create.isPending;
  useLayoutEffect(() => {
    if (quickServiceOpen) return;
    quickServiceTrigger.current?.focus();
    quickServiceTrigger.current = null;
  }, [quickServiceOpen]);

  const set = (key: keyof FormState, value: string) => { setForm((current) => ({ ...current, [key]: value })); setValidation(''); };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!companyId || busy) return;
    if (!form.name.trim()) { setValidation('Informe o nome do lead.'); return; }
    const input: CrmLeadInput = {
      lead: { name: form.name.trim(), organizationName: nullable(form.organizationName), phone: nullable(form.phone), email: nullable(form.email)?.toLowerCase() ?? null, notes: nullable(form.notes) },
      interest: { primaryServiceId: form.serviceId || null },
      capture: { sourceLabel: nullable(form.sourceLabel), utmSource: nullable(form.utmSource), utmMedium: nullable(form.utmMedium), utmCampaign: nullable(form.utmCampaign), utmContent: nullable(form.utmContent) },
    };
    create.mutate(input);
  }
  return <RegistrationDialog
    eyebrow="CADASTRO DE LEADS"
    title="Adicionar lead"
    description="O primeiro card será criado automaticamente em Novo lead."
    panelClassName="crm-lead-form"
    dismissDisabled={busy}
    onClose={onClose}
    overlay={quickServiceOpen ? <ServiceCreateModal companyId={companyId} onClose={() => setQuickServiceOpen(false)} onCreated={(service, municipalCodeSaved) => {
      setCreatedServices((current) => [...current, service]);
      set('serviceId', service.id);
      if (!municipalCodeSaved) setValidation('Serviço cadastrado, mas o código municipal não foi salvo. Ajuste-o no cadastro de Serviços.');
      setQuickServiceOpen(false);
    }} /> : undefined}
  >
    {(requestClose) => (
      <form onSubmit={submit}>
        <div className="drawer__body crm-lead-form__body">
          {companyChoice && <CompanyField choice={companyChoice} value={companyId} disabled={busy} />}
          <fieldset className="crm-fieldset" disabled={!companyId}>
            <div className="crm-form-grid crm-form-grid--two">
              <label className="field"><span>Nome</span><input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Nome da pessoa" maxLength={200} /></label>
              <label className="field"><span>Empresa</span><input value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} placeholder="Empresa em que trabalha" maxLength={200} /></label>
              <label className="field"><span>WhatsApp / telefone</span><input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(00) 00000-0000" maxLength={64} /></label>
              <label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="contato@empresa.com" maxLength={254} /></label>
              <div className="proposal-service-pick crm-field--wide">
                <label className="field">
                  <span>Serviço de interesse</span>
                  <SaleDropdown label="Serviço de interesse" disabled={!canReadServices} value={form.serviceId} onChange={(value) => set('serviceId', value)} options={[
                    { value: '', label: 'Ainda não definido' },
                    ...serviceOptions.map((service) => ({ value: service.id, label: service.name })),
                  ]} />
                </label>
                {canCreateService && <button type="button" className="proposal-inline-new" onClick={(event) => {
                  quickServiceTrigger.current = event.currentTarget;
                  setQuickServiceOpen(true);
                }}>+ Novo</button>}
              </div>
              <label className="field crm-field--wide"><span>Observações, interesses ou necessidades.</span><textarea className="crm-lead-form__notes" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Contexto importante para o próximo contato" maxLength={10000} /></label>
            </div>
            <div className="crm-origin">
              <button type="button" className="crm-origin__toggle" onClick={() => setShowOrigin((value) => !value)} aria-expanded={showOrigin}>
                <Megaphone size={17} /><span><strong>Origem da captação</strong><small>Opcional · preserve a campanha deste lead</small></span>
                <ChevronDown size={17} className={showOrigin ? 'is-open' : ''} />
              </button>
              {showOrigin && <div className="crm-origin__fields">
                <div className="crm-form-grid crm-form-grid--two">
                  <label className="field"><span>Origem</span><input value={form.sourceLabel} onChange={(e) => set('sourceLabel', e.target.value)} placeholder="Ex.: Indicação" maxLength={120} /></label>
                  <label className="field"><span>UTM source</span><input value={form.utmSource} onChange={(e) => set('utmSource', e.target.value)} placeholder="instagram" maxLength={200} /></label>
                  <label className="field"><span>UTM medium</span><input value={form.utmMedium} onChange={(e) => set('utmMedium', e.target.value)} placeholder="paid_social" maxLength={200} /></label>
                  <label className="field"><span>UTM campaign</span><input value={form.utmCampaign} onChange={(e) => set('utmCampaign', e.target.value)} placeholder="campanha_outubro" maxLength={200} /></label>
                  <label className="field crm-field--wide"><span>UTM content</span><input value={form.utmContent} onChange={(e) => set('utmContent', e.target.value)} placeholder="criativo_video_01" maxLength={200} /></label>
                </div>
              </div>}
            </div>
          </fieldset>
        </div>
        {(validation || create.isError) && <div className="drawer__save-feedback" role="alert">{validation || (create.error instanceof ApiError ? create.error.message : 'Não foi possível criar o lead.')}</div>}
        <footer className="drawer__footer">
          <button type="button" className="button button--secondary" onClick={requestClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="button button--primary" disabled={busy || !companyId}>{busy ? 'Adicionando...' : 'Adicionar lead'}</button>
        </footer>
      </form>
    )}
  </RegistrationDialog>;
}
