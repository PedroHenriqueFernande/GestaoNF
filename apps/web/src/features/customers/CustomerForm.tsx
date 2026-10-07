import { useEffect, useRef } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, ContactRound, MapPin, Save, StickyNote, UserRound, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { ApiError, type Customer, type CustomerInput } from '../../api/client';
import { formatPhone, formatPostalCode, formatTaxId } from '../../utils/format';

const customerSchema = z.object({
  kind: z.enum(['PF', 'PJ']),
  name: z.string().trim().min(2, 'Informe o nome do cliente.').max(200, 'Limite de 200 caracteres.'),
  tradeName: z.string().max(200),
  taxId: z.string(),
  email: z.union([z.literal(''), z.email('Informe um e-mail válido.')]),
  phone: z.string().max(32),
  street: z.string().max(200),
  number: z.string().max(30),
  complement: z.string().max(100),
  district: z.string().max(120),
  postalCode: z.string(),
  cityName: z.string().max(150),
  cityIbgeCode: z.string(),
  stateCode: z.string(),
  notes: z.string().max(10000),
}).superRefine((values, context) => {
  const document = values.taxId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (document && !(values.kind === 'PF' ? /^\d{11}$/.test(document) : /^[A-Z0-9]{12}\d{2}$/.test(document))) {
    context.addIssue({ code: 'custom', path: ['taxId'], message: values.kind === 'PF' ? 'O CPF deve ter 11 dígitos.' : 'O CNPJ deve ter 14 posições, com 2 dígitos finais.' });
  }
  if (values.postalCode && !/^\d{8}$/.test(values.postalCode.replace(/\D/g, ''))) context.addIssue({ code: 'custom', path: ['postalCode'], message: 'O CEP deve ter 8 dígitos.' });
  if (values.cityIbgeCode && !/^\d{7}$/.test(values.cityIbgeCode)) context.addIssue({ code: 'custom', path: ['cityIbgeCode'], message: 'O código IBGE deve ter 7 dígitos.' });
  if (values.stateCode && !/^[A-Z]{2}$/.test(values.stateCode.toUpperCase())) context.addIssue({ code: 'custom', path: ['stateCode'], message: 'Informe a sigla da UF.' });
});

type Values = z.infer<typeof customerSchema>;
type FieldName = keyof Values;

function defaults(customer?: Customer): Values {
  return {
    kind: customer?.kind ?? 'PF', name: customer?.name ?? '', tradeName: customer?.tradeName ?? '',
    taxId: formatTaxId(customer?.taxId, customer?.kind), email: customer?.email ?? '', phone: formatPhone(customer?.phone),
    street: customer?.street ?? '', number: customer?.number ?? '', complement: customer?.complement ?? '',
    district: customer?.district ?? '', postalCode: formatPostalCode(customer?.postalCode),
    cityName: customer?.cityName ?? '', cityIbgeCode: customer?.cityIbgeCode ?? '', stateCode: customer?.stateCode ?? '',
    notes: customer?.notes ?? '',
  };
}

function payload(values: Values): CustomerInput {
  const nullable = (value: string) => value.trim() || null;
  return {
    kind: values.kind,
    name: values.name.trim(),
    tradeName: values.kind === 'PJ' ? nullable(values.tradeName) : null,
    taxId: nullable(values.taxId.toUpperCase().replace(/[^A-Z0-9]/g, '')),
    email: nullable(values.email),
    phone: nullable(values.phone.replace(/\D/g, '')),
    notes: nullable(values.notes),
    street: nullable(values.street),
    number: nullable(values.number),
    complement: nullable(values.complement),
    district: nullable(values.district),
    postalCode: nullable(values.postalCode.replace(/\D/g, '')),
    cityName: nullable(values.cityName),
    cityIbgeCode: nullable(values.cityIbgeCode),
    stateCode: nullable(values.stateCode.toUpperCase()),
    countryCode: 'BR',
  };
}

function Field({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <b> *</b>}</span>{children}{hint && <small className="field-hint">{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}

export function CustomerForm({ customer, onClose, onSave, saving, saveError }: {
  customer?: Customer;
  onClose: () => void;
  onSave: (input: CustomerInput) => Promise<void>;
  saving: boolean;
  saveError: unknown;
}) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(customerSchema), defaultValues: defaults(customer) });
  const kind = form.watch('kind');
  const { errors } = form.formState;
  const saveFeedback = saveError instanceof ApiError
    ? `${saveError.message} Cliente não foi salvo.`
    : form.formState.isSubmitted && Object.keys(errors).length > 0
      ? 'Corrija os campos indicados. Cliente não foi salvo.'
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
        if (error.status === 409) form.setError('taxId', { message: error.message });
        if (error.status === 400 && /CPF|CNPJ/.test(error.message)) form.setError('taxId', { message: error.message });
      }
    }
  }

  return <div className="drawer-backdrop">
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
      <div className="drawer__header">
        <div><p className="eyebrow">CADASTRO DE CLIENTES</p><h2 id="customer-form-title">{customer ? 'Editar cliente' : 'Novo cliente'}</h2><p>Dados de identificação, contato e endereço.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar formulário"><X size={20} /></button>
      </div>
      <form id="customer-form" onSubmit={form.handleSubmit(submit)} noValidate>
        <div className="drawer__body">
          <div className="form-section-heading"><UserRound size={17} /><div><h3>Identificação</h3><p>Informações básicas do cliente</p></div></div>
          <div className="kind-selector" role="group" aria-label="Tipo de cliente">
            <button type="button" className={kind === 'PF' ? 'is-selected' : ''} onClick={() => form.setValue('kind', 'PF', { shouldValidate: true })}><UserRound size={17} /> Pessoa física</button>
            <button type="button" className={kind === 'PJ' ? 'is-selected' : ''} onClick={() => form.setValue('kind', 'PJ', { shouldValidate: true })}><Building2 size={17} /> Pessoa jurídica</button>
          </div>
          <div className="form-grid">
            <Field label={kind === 'PF' ? 'Nome completo' : 'Razão social'} required error={errors.name?.message}><Controller name="name" control={form.control} render={({ field }) => <input {...field} ref={(element) => { field.ref(element); nameRef.current = element; }} placeholder={kind === 'PF' ? 'Ex.: Ana Oliveira' : 'Ex.: Empresa Exemplo Ltda.'} aria-invalid={!!errors.name} />} /></Field>
            {kind === 'PJ' && <Field label="Nome fantasia" error={errors.tradeName?.message}><input placeholder="Nome conhecido comercialmente" {...form.register('tradeName')} /></Field>}
            <Field label={kind === 'PF' ? 'CPF' : 'CNPJ'} error={errors.taxId?.message} hint="Opcional no cadastro; exigido quando a operação fiscal pedir."><Controller name="taxId" control={form.control} render={({ field }) => <input value={field.value} onChange={(event) => field.onChange(formatTaxId(event.target.value, kind))} onBlur={field.onBlur} placeholder={kind === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} inputMode={kind === 'PF' ? 'numeric' : 'text'} aria-invalid={!!errors.taxId} />} /></Field>
          </div>

          <div className="form-section-heading"><ContactRound size={17} /><div><h3>Contato</h3><p>Canais para comunicação</p></div></div>
          <div className="form-grid form-grid--two">
            <Field label="E-mail" error={errors.email?.message}><input type="email" placeholder="cliente@email.com" aria-invalid={!!errors.email} {...form.register('email')} /></Field>
            <Field label="Telefone / WhatsApp" error={errors.phone?.message}><Controller name="phone" control={form.control} render={({ field }) => <input value={field.value} onChange={(event) => field.onChange(formatPhone(event.target.value))} onBlur={field.onBlur} placeholder="(00) 00000-0000" inputMode="tel" aria-invalid={!!errors.phone} />} /></Field>
          </div>

          <div className="form-section-heading"><MapPin size={17} /><div><h3>Endereço</h3><p>Preencha quando houver necessidade de identificação fiscal</p></div></div>
          <div className="form-grid form-grid--address">
            <Field label="CEP" error={errors.postalCode?.message}><Controller name="postalCode" control={form.control} render={({ field }) => <input value={field.value} onChange={(event) => field.onChange(formatPostalCode(event.target.value))} onBlur={field.onBlur} placeholder="00000-000" inputMode="numeric" aria-invalid={!!errors.postalCode} />} /></Field>
            <Field label="Logradouro" error={errors.street?.message}><input placeholder="Rua, avenida..." {...form.register('street')} /></Field>
            <Field label="Número" error={errors.number?.message}><input placeholder="Nº" {...form.register('number')} /></Field>
            <Field label="Complemento" error={errors.complement?.message}><input placeholder="Sala, bloco..." {...form.register('complement')} /></Field>
            <Field label="Bairro" error={errors.district?.message}><input placeholder="Bairro" {...form.register('district')} /></Field>
            <Field label="Cidade" error={errors.cityName?.message}><input placeholder="Cidade" {...form.register('cityName')} /></Field>
            <Field label="UF" error={errors.stateCode?.message}><input placeholder="SP" maxLength={2} {...form.register('stateCode', { onChange: (event) => { event.target.value = event.target.value.toUpperCase(); } })} aria-invalid={!!errors.stateCode} /></Field>
            <Field label="Código IBGE" error={errors.cityIbgeCode?.message}><input placeholder="7 dígitos" maxLength={7} inputMode="numeric" {...form.register('cityIbgeCode')} aria-invalid={!!errors.cityIbgeCode} /></Field>
          </div>

          <div className="form-section-heading form-section-heading--last"><StickyNote size={17} /><div><h3>Observações</h3><p>Notas internas sobre este cliente</p></div></div>
          <Field label="Observações" error={errors.notes?.message}><textarea rows={4} placeholder="Informações úteis para o atendimento..." {...form.register('notes')} /></Field>
        </div>
        {saveFeedback && <div className="drawer__save-feedback" role="alert">{saveFeedback}</div>}
        <div className="drawer__footer"><button type="button" className="button button--secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving}><Save size={17} />{saving ? 'Salvando...' : customer ? 'Salvar alterações' : 'Cadastrar cliente'}</button></div>
      </form>
    </aside>
  </div>;
}
