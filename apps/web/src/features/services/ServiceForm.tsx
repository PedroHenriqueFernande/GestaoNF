import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpenText, CircleCheck, ClipboardList, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError, type MunicipalTaxCode, type Service, type ServiceInput } from '../../api/client';

const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do serviço.').max(200, 'Limite de 200 caracteres.'),
  internalCode: z.string().max(20, 'Limite de 20 caracteres.'),
  description: z.string().max(1000, 'Limite de 1.000 caracteres.'),
  unitLabel: z.string().trim().min(1, 'Informe a unidade.').max(16, 'Limite de 16 caracteres.'),
  suggestedUnitPrice: z.string().refine((value) => !value.trim() || /^(?:0|[1-9]\d{0,12})(?:[.,]\d{1,2})?$/.test(value.trim()), 'Use um valor positivo com até 2 casas decimais.'),
  nationalTaxCode: z.string().refine((value) => !value || /^\d{6}$/.test(value), 'Informe os 6 dígitos do cTribNac.'),
  nbsCode: z.string().refine((value) => !value || /^\d{9}$/.test(value), 'Informe os 9 dígitos da NBS.'),
});

type Values = z.infer<typeof serviceSchema>;
type FieldName = keyof Values;

function defaults(service?: Service): Values {
  return {
    name: service?.name ?? '',
    internalCode: service?.internalCode ?? '',
    description: service?.description ?? '',
    unitLabel: service?.unitLabel ?? 'UN',
    suggestedUnitPrice: service?.suggestedUnitPrice?.replace('.', ',') ?? '',
    nationalTaxCode: service?.nationalTaxCode ?? '',
    nbsCode: service?.nbsCode ?? '',
  };
}

function payload(values: Values): ServiceInput {
  const nullable = (value: string) => value.trim() || null;
  return {
    name: values.name.trim(),
    internalCode: nullable(values.internalCode),
    description: nullable(values.description),
    unitLabel: values.unitLabel.trim(),
    suggestedUnitPrice: nullable(values.suggestedUnitPrice.replace(',', '.')),
    nationalTaxCode: nullable(values.nationalTaxCode),
    nbsCode: nullable(values.nbsCode),
  };
}

function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span>{children}{hint && <small className="field-hint">{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}

function MunicipalCodes({ companyId, serviceId }: { companyId: string; serviceId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['municipal-tax-codes', companyId, serviceId] as const;
  const codes = useQuery({ queryKey, queryFn: () => api.municipalTaxCodes(companyId, serviceId) });
  const [city, setCity] = useState('');
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState('');
  const save = useMutation({
    mutationFn: () => api.upsertMunicipalTaxCode(companyId, serviceId, city, code),
    onSuccess: (entry) => {
      queryClient.setQueryData<MunicipalTaxCode[]>(queryKey, (previous) => previous
        ? [...previous.filter((item) => item.municipalityIbgeCode !== entry.municipalityIbgeCode), entry]
          .sort((a, b) => a.municipalityIbgeCode.localeCompare(b.municipalityIbgeCode)) : [entry]);
      setCity('');
      setCode('');
      setFeedback('Código municipal salvo.');
    },
  });
  const remove = useMutation({
    mutationFn: (municipalityIbgeCode: string) => api.removeMunicipalTaxCode(companyId, serviceId, municipalityIbgeCode),
    onSuccess: (_result, municipalityIbgeCode) => {
      queryClient.setQueryData<MunicipalTaxCode[]>(queryKey, (previous) => previous?.filter((item) => item.municipalityIbgeCode !== municipalityIbgeCode));
      setFeedback('Código municipal removido.');
    },
  });

  function submit() {
    setFeedback('');
    if (!/^\d{7}$/.test(city) || !/^\d{3}$/.test(code)) {
      setFeedback('Informe os 7 dígitos do IBGE e os 3 dígitos do código municipal.');
      return;
    }
    save.mutate();
  }

  return <div className="municipal-codes">
    <div className="form-section-heading"><BookOpenText size={17} /><div><h3>Códigos municipais</h3><p>Configure um código para cada município de incidência</p></div></div>
    {codes.isPending ? <p className="municipal-codes__empty">Carregando códigos...</p> : codes.isError ? <div className="inline-error" role="alert">Não foi possível carregar os códigos. <button type="button" onClick={() => codes.refetch()}>Tentar novamente</button></div> : codes.data.length > 0 ? <div className="municipal-codes__list">{codes.data.map((item) => <div className="municipal-codes__row" key={item.municipalityIbgeCode}>
      <span>IBGE <strong>{item.municipalityIbgeCode}</strong></span><span>cTribMun <strong>{item.municipalTaxCode}</strong></span>
      <button type="button" title={`Editar município ${item.municipalityIbgeCode}`} aria-label={`Editar município ${item.municipalityIbgeCode}`} onClick={() => { setCity(item.municipalityIbgeCode); setCode(item.municipalTaxCode); setFeedback(''); }}><Pencil size={15} /></button>
      <button type="button" title={`Remover município ${item.municipalityIbgeCode}`} aria-label={`Remover município ${item.municipalityIbgeCode}`} onClick={() => remove.mutate(item.municipalityIbgeCode)} disabled={remove.isPending}><Trash2 size={15} /></button>
    </div>)}</div> : <p className="municipal-codes__empty">Nenhum código municipal configurado.</p>}
    <div className="municipal-codes__form">
      <Field label="Município (IBGE)"><input value={city} onChange={(event) => setCity(event.target.value.replace(/\D/g, '').slice(0, 7))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }} placeholder="7 dígitos" inputMode="numeric" maxLength={7} /></Field>
      <Field label="Código municipal"><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 3))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }} placeholder="000" inputMode="numeric" maxLength={3} /></Field>
      <button type="button" className="button button--secondary" onClick={submit} disabled={save.isPending || !codes.data}><Plus size={15} />{save.isPending ? 'Salvando...' : 'Salvar código'}</button>
    </div>
    {feedback && <p className="municipal-codes__feedback" role="status">{feedback}</p>}
    {(save.isError || remove.isError) && <p className="municipal-codes__error" role="alert">{(save.error ?? remove.error) instanceof Error ? (save.error ?? remove.error)?.message : 'Não foi possível alterar o código.'}</p>}
  </div>;
}

export function ServiceForm({ companyId, service, onClose, onSave, saving, saveError }: {
  companyId: string;
  service?: Service;
  onClose: () => void;
  onSave: (input: ServiceInput) => Promise<void>;
  saving: boolean;
  saveError: unknown;
}) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(serviceSchema), defaultValues: defaults(service) });
  const { errors } = form.formState;
  const saveFeedback = saveError instanceof ApiError
    ? `${saveError.message} Serviço não foi salvo.`
    : form.formState.isSubmitted && Object.keys(errors).length > 0
      ? 'Corrija os campos indicados. Serviço não foi salvo.'
      : null;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [onClose]);

  async function submit(values: Values) {
    try { await onSave(payload(values)); }
    catch (error) {
      if (error instanceof ApiError) {
        for (const issue of error.issues) {
          if (issue.path in values) form.setError(issue.path as FieldName, { message: issue.message });
        }
        if (error.status === 409) form.setError('internalCode', { message: error.message });
      }
    }
  }

  return <div className="drawer-backdrop">
    <aside className="drawer service-drawer" role="dialog" aria-modal="true" aria-labelledby="service-form-title">
      <div className="drawer__header">
        <div><p className="eyebrow">CADASTRO DE SERVIÇOS</p><h2 id="service-form-title">{service ? 'Editar serviço' : 'Novo serviço'}</h2><p>Dados comerciais e classificação para NFS-e.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar formulário"><X size={20} /></button>
      </div>
      <form id="service-form" onSubmit={form.handleSubmit(submit)} noValidate>
        <div className="drawer__body">
          <div className="form-section-heading"><ClipboardList size={17} /><div><h3>Dados comerciais</h3><p>Informações usadas no catálogo e nas vendas</p></div></div>
          <div className="form-grid">
            <Field label="Nome do serviço" required error={errors.name?.message}><Controller name="name" control={form.control} render={({ field }) => <input {...field} ref={(element) => { field.ref(element); nameRef.current = element; }} placeholder="Ex.: Consultoria técnica" aria-invalid={!!errors.name} />} /></Field>
            <div className="form-grid form-grid--two">
              <Field label="Código interno" error={errors.internalCode?.message}><input placeholder="Ex.: SERV-001" aria-invalid={!!errors.internalCode} {...form.register('internalCode')} /></Field>
              <Field label="Unidade comercial" required error={errors.unitLabel?.message}><input placeholder="UN, H, DIÁRIA..." aria-invalid={!!errors.unitLabel} {...form.register('unitLabel')} /></Field>
            </div>
            <Field label="Valor unitário sugerido" error={errors.suggestedUnitPrice?.message} hint="Valor de referência. O total da NFS-e será definido na prestação."><input placeholder="0,00" inputMode="decimal" aria-invalid={!!errors.suggestedUnitPrice} {...form.register('suggestedUnitPrice')} /></Field>
            <Field label="Descrição" error={errors.description?.message} hint="Até 1.000 caracteres. Ajuste o texto na emissão para descrever o serviço prestado."><textarea rows={3} placeholder="Descreva o serviço..." aria-invalid={!!errors.description} {...form.register('description')} /></Field>
          </div>
          <div className="form-section-heading"><BookOpenText size={17} /><div><h3>Classificação fiscal</h3><p>Códigos de referência para a NFS-e</p></div></div>
          <div className="service-fiscal-note"><AlertCircle size={16} /><span>O cadastro pode ser salvo sem classificação. O código nacional e os dados da operação serão verificados antes da emissão.</span></div>
          <div className="form-grid form-grid--two">
            <Field label="Código de tributação nacional (cTribNac)" error={errors.nationalTaxCode?.message} hint="6 dígitos, sem pontuação."><input placeholder="000000" inputMode="numeric" maxLength={6} aria-invalid={!!errors.nationalTaxCode} {...form.register('nationalTaxCode', { onChange: (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); } })} /></Field>
            <Field label="Código NBS" error={errors.nbsCode?.message} hint="9 dígitos, quando aplicável."><input placeholder="000000000" inputMode="numeric" maxLength={9} aria-invalid={!!errors.nbsCode} {...form.register('nbsCode', { onChange: (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 9); } })} /></Field>
          </div>
          {service ? <MunicipalCodes companyId={companyId} serviceId={service.id} /> : <div className="service-municipal-pending"><CircleCheck size={16} /> Após cadastrar, abra o serviço para configurar os códigos municipais.</div>}
        </div>
        {saveFeedback && <div className="drawer__save-feedback" role="alert">{saveFeedback}</div>}
        <div className="drawer__footer"><button type="button" className="button button--secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving}><Save size={17} />{saving ? 'Salvando...' : service ? 'Salvar alterações' : 'Cadastrar serviço'}</button></div>
      </form>
    </aside>
  </div>;
}
