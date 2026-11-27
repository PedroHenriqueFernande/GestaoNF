import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Save, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { PERMISSION_DENIED_MESSAGE } from '@gestaonf/permissions';
import { api, ApiError, type Service, type ServiceInput } from '../../api/client';
import { SERVICE_DESCRIPTION_MAX } from './service-limits';

const serviceSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do serviço.').max(200, 'Limite de 200 caracteres.'),
  internalCode: z.string().max(20, 'Limite de 20 caracteres.'),
  description: z.string().max(SERVICE_DESCRIPTION_MAX, `Limite de ${SERVICE_DESCRIPTION_MAX} caracteres.`),
  suggestedUnitPrice: z.string().refine((value) => !value.trim() || /^(?:0|[1-9]\d{0,12})(?:[.,]\d{1,2})?$/.test(value.trim()), 'Use um valor positivo com até 2 casas decimais.'),
  nationalTaxCode: z.string().refine((value) => !value || /^\d{6}$/.test(value), 'Informe os 6 dígitos do cTribNac.'),
  nbsCode: z.string().refine((value) => !value || /^\d{9}$/.test(value), 'Informe os 9 dígitos da NBS.'),
  simplesActivityCode: z.enum(['', '07', '08', '09', '10', '11', '12', '13', '14', '90']),
  municipalTaxCode: z.string().refine((value) => !value || /^\d{3}$/.test(value), 'Informe os 3 dígitos.'),
});

type Values = z.infer<typeof serviceSchema>;
type FieldName = keyof Values;

function defaults(service?: Service): Values {
  return {
    name: service?.name ?? '',
    internalCode: service?.internalCode ?? '',
    description: service?.description ?? '',
    suggestedUnitPrice: service?.suggestedUnitPrice?.replace('.', ',') ?? '',
    nationalTaxCode: service?.nationalTaxCode ?? '',
    nbsCode: service?.nbsCode ?? '',
    simplesActivityCode: service?.simplesActivityCode ?? '',
    municipalTaxCode: '',
  };
}

/**
 * Código de tributação municipal (cTribMun) do serviço na cidade da empresa: a emissão só atende o município da
 * empresa, então a tela grava apenas esse. A cidade vem do CEP do cadastro da empresa.
 * `changed` evita gravar quando nada mudou; `code: null` remove o código salvo.
 */
export type ServiceMunicipalCode = { municipalityIbgeCode: string; code: string | null; changed: boolean };

function payload(values: Values): ServiceInput {
  const nullable = (value: string) => value.trim() || null;
  return {
    name: values.name.trim(),
    internalCode: nullable(values.internalCode),
    description: nullable(values.description),
    suggestedUnitPrice: nullable(values.suggestedUnitPrice.replace(',', '.')),
    nationalTaxCode: nullable(values.nationalTaxCode),
    nbsCode: nullable(values.nbsCode),
    simplesActivityCode: values.simplesActivityCode || null,
  };
}

function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span>{children}{hint && <small className="field-hint">{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}

export function ServiceForm({ companyId, service, canEditPrice, onClose, onSave, saving, saveError }: {
  companyId: string;
  service?: Service;
  /** Sem `services.edit_price`, o preço de um serviço existente fica somente leitura (D6). */
  canEditPrice: boolean;
  onClose: () => void;
  onSave: (input: ServiceInput, municipalCode: ServiceMunicipalCode | null) => Promise<void>;
  saving: boolean;
  saveError: unknown;
}) {
  const priceLocked = !!service && !canEditPrice;
  const nameRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const form = useForm<Values>({ resolver: zodResolver(serviceSchema), defaultValues: defaults(service) });
  const descriptionLength = form.watch('description')?.length ?? 0;
  const company = useQuery({ queryKey: ['company', companyId], queryFn: () => api.company(companyId) });
  const cityIbgeCode = company.data?.cityIbgeCode ?? null;
  const savedCodes = useQuery({ queryKey: ['municipal-tax-codes', companyId, service?.id], queryFn: () => api.municipalTaxCodes(companyId, service!.id), enabled: !!service });
  const savedCode = savedCodes.data?.find((item) => item.municipalityIbgeCode === cityIbgeCode)?.municipalTaxCode ?? '';
  // Ao abrir um serviço, o campo recebe o código já salvo para a cidade da empresa (sem sobrescrever o que já foi digitado).
  useEffect(() => { if (savedCode && !form.getFieldState('municipalTaxCode').isDirty) form.setValue('municipalTaxCode', savedCode); }, [savedCode, form]);
  const { errors } = form.formState;
  const saveFeedback = saveError instanceof ApiError
    ? `${saveError.message} Serviço não foi salvo.`
    : form.formState.isSubmitted && Object.keys(errors).length > 0
      ? 'Corrija os campos indicados. Serviço não foi salvo.'
      : null;

  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const lockPageScroll = !nameRef.current?.closest('dialog:modal');
    const root = document.documentElement;
    const hasScrollbarSpace = lockPageScroll && window.innerWidth > root.clientWidth;
    const originalOverflow = document.body.style.overflow;
    const originalGutter = root.style.scrollbarGutter;
    if (hasScrollbarSpace) {
      if (getComputedStyle(root).scrollbarGutter === 'auto') root.style.scrollbarGutter = 'stable';
      root.classList.add('service-form-scroll-gutter');
    }
    if (lockPageScroll) {
      document.body.style.overflow = 'hidden';
    }
    nameRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      if (lockPageScroll) {
        document.body.style.overflow = originalOverflow;
      }
      if (hasScrollbarSpace) {
        root.style.scrollbarGutter = originalGutter;
        root.classList.remove('service-form-scroll-gutter');
      }
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, []);

  async function submit(values: Values) {
    const code = values.municipalTaxCode || null;
    const municipalCode = cityIbgeCode ? { municipalityIbgeCode: cityIbgeCode, code, changed: (code ?? '') !== savedCode } : null;
    try { await onSave(payload(values), municipalCode); }
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
        <div className="drawer__body service-form__body">
          <div className="form-grid">
            <div className="form-grid service-form__name-row">
              <Field label="Nome do serviço" required error={errors.name?.message}><Controller name="name" control={form.control} render={({ field }) => <input {...field} ref={(element) => { field.ref(element); nameRef.current = element; }} placeholder="Ex.: Consultoria técnica" aria-invalid={!!errors.name} />} /></Field>
              <Field label="Código municipal" error={errors.municipalTaxCode?.message} hint={company.isSuccess && !cityIbgeCode ? 'Informe o CEP da empresa para usar.' : undefined}>
                <input placeholder="000" inputMode="numeric" maxLength={3} disabled={!cityIbgeCode} title={company.data?.cityName ? `Código de tributação do serviço em ${company.data.cityName}` : undefined} aria-invalid={!!errors.municipalTaxCode} {...form.register('municipalTaxCode', { onChange: (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 3); } })} />
              </Field>
            </div>
            <div className="form-grid form-grid--two">
              <Field label="Código interno" error={errors.internalCode?.message}><input placeholder="Ex.: SERV-001" aria-invalid={!!errors.internalCode} {...form.register('internalCode')} /></Field>
              <Field label="Valor do serviço" error={errors.suggestedUnitPrice?.message} hint={priceLocked ? PERMISSION_DENIED_MESSAGE : undefined}><input placeholder="0,00" inputMode="decimal" readOnly={priceLocked} aria-invalid={!!errors.suggestedUnitPrice} {...form.register('suggestedUnitPrice')} /></Field>
            </div>
          </div>
          <div className="form-grid form-grid--two">
            <Field label="Código de tributação nacional (cTribNac)" error={errors.nationalTaxCode?.message} hint="6 dígitos, sem pontuação."><input placeholder="000000" inputMode="numeric" maxLength={6} aria-invalid={!!errors.nationalTaxCode} {...form.register('nationalTaxCode', { onChange: (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); } })} /></Field>
            <Field label="Código NBS" error={errors.nbsCode?.message} hint="9 dígitos, quando aplicável."><input placeholder="000000000" inputMode="numeric" maxLength={9} aria-invalid={!!errors.nbsCode} {...form.register('nbsCode', { onChange: (event) => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 9); } })} /></Field>
          </div>
          <Field label="Categoria da atividade no Simples Nacional" error={errors.simplesActivityCode?.message} hint="Opcional. Indica como este serviço se enquadra no Simples. Confirme a categoria com seu contador.">
            <select {...form.register('simplesActivityCode')}><option value="">Não informado</option>
              <option value="07">Serviços tributados exclusivamente pelo Anexo III</option>
              <option value="08">Contabilidade com ISS fixo no município - Anexo III</option>
              <option value="09">Serviços sujeitos ao Fator R - Anexo III ou V</option>
              <option value="10">Transporte municipal de passageiros - Anexo III</option>
              <option value="11">Locação e operações sem incidência de ISS - Anexo III</option>
              <option value="12">Construção civil - Anexo III</option>
              <option value="13">Construção civil - Anexo IV</option>
              <option value="14">Serviços tributados pelo Anexo IV</option>
              <option value="90">Operações não tributadas</option>
            </select>
          </Field>
          <Field label="Descrição" error={errors.description?.message} hint={`${descriptionLength}/${SERVICE_DESCRIPTION_MAX} caracteres`}><textarea className="service-form__description" rows={3} maxLength={SERVICE_DESCRIPTION_MAX} placeholder="Descreva o serviço..." aria-invalid={!!errors.description} {...form.register('description')} /></Field>
        </div>
        {saveFeedback && <div className="drawer__save-feedback" role="alert">{saveFeedback}</div>}
        <div className="drawer__footer"><button type="button" className="button button--secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving}><Save size={17} />{saving ? 'Salvando...' : service ? 'Salvar alterações' : 'Cadastrar serviço'}</button></div>
      </form>
    </aside>
  </div>;
}
