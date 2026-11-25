import { useEffect, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Globe2, Save, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { ApiError, type Customer, type CustomerInput } from '../../api/client';
import { formatPhone, formatPostalCode, formatTaxId } from '../../utils/format';
import { CountryOptions } from '../../components/CountryOptions';
import { StateOptions } from '../../components/StateOptions';
import { lookupBrazilianAddress } from '../../utils/cep';
import './customer-form.css';

const customerSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do cliente.').max(200, 'Limite de 200 caracteres.'),
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
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Selecione o país.'),
  foreignTaxId: z.string().trim().max(40, 'Limite de 40 caracteres.'),
  noForeignTaxIdReason: z.enum(['', '1', '2']),
  foreignPostalCode: z.string().trim().max(11, 'Limite de 11 caracteres.'),
  foreignStateProvince: z.string().trim().max(60, 'Limite de 60 caracteres.'),
  notes: z.string().max(10000),
}).superRefine((values, context) => {
  const document = values.taxId.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (document && !/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(document)) context.addIssue({ code: 'custom', path: ['taxId'], message: 'Informe um CPF ou CNPJ válido.' });
  if (values.postalCode && !/^\d{8}$/.test(values.postalCode.replace(/\D/g, ''))) context.addIssue({ code: 'custom', path: ['postalCode'], message: 'O CEP deve ter 8 dígitos.' });
  if (values.cityIbgeCode && !/^\d{7}$/.test(values.cityIbgeCode)) context.addIssue({ code: 'custom', path: ['cityIbgeCode'], message: 'O código IBGE deve ter 7 dígitos.' });
  if (values.stateCode && !/^[A-Z]{2}$/.test(values.stateCode.toUpperCase())) context.addIssue({ code: 'custom', path: ['stateCode'], message: 'Informe a sigla da UF.' });
  if (values.foreignTaxId && values.noForeignTaxIdReason) context.addIssue({ code: 'custom', path: ['foreignTaxId'], message: 'Informe o documento ou o motivo da ausência.' });
});

type Values = z.infer<typeof customerSchema>;
type FieldName = keyof Values;

function defaults(customer?: Customer): Values {
  return {
    name: customer?.name ?? '',
    taxId: formatTaxId(customer?.taxId, customer?.kind), email: customer?.email ?? '', phone: formatPhone(customer?.phone),
    street: customer?.street ?? '', number: customer?.number ?? '', complement: customer?.complement ?? '',
    district: customer?.district ?? '', postalCode: formatPostalCode(customer?.postalCode),
    cityName: customer?.cityName ?? '', cityIbgeCode: customer?.cityIbgeCode ?? '', stateCode: customer?.stateCode ?? '',
    countryCode: customer?.countryCode ?? 'BR',
    foreignTaxId: customer?.foreignTaxId ?? '', noForeignTaxIdReason: customer?.noForeignTaxIdReason ?? '',
    foreignPostalCode: customer?.foreignPostalCode ?? '', foreignStateProvince: customer?.foreignStateProvince ?? '',
    notes: customer?.notes ?? '',
  };
}

function payload(values: Values): CustomerInput {
  const nullable = (value: string) => value.trim() || null;
  return {
    name: values.name.trim(),
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
    countryCode: values.countryCode,
    foreignTaxId: nullable(values.foreignTaxId),
    noForeignTaxIdReason: values.noForeignTaxIdReason || null,
    foreignPostalCode: nullable(values.foreignPostalCode),
    foreignStateProvince: nullable(values.foreignStateProvince),
  };
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}{error && <small className="field-error">{error}</small>}</label>;
}

export function CustomerForm({ customer, onClose, onSave, saving, saveError }: {
  customer?: Customer;
  onClose: () => void;
  onSave: (input: CustomerInput) => Promise<void>;
  saving: boolean;
  saveError: unknown;
}) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const postalLookupVersion = useRef(0);
  const [postalFeedback, setPostalFeedback] = useState('');
  const form = useForm<Values>({ resolver: zodResolver(customerSchema), defaultValues: defaults(customer) });
  const country = form.watch('countryCode');
  const foreignAddress = country !== 'BR';
  const foreignTaxId = form.watch('foreignTaxId');
  const noForeignTaxIdReason = form.watch('noForeignTaxIdReason');
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
    return () => { postalLookupVersion.current += 1; document.body.style.overflow = originalOverflow; document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [onClose]);

  async function resolvePostalCode(values: Values): Promise<Values> {
    const postalCode = values.postalCode.replace(/\D/g, '');
    if (values.countryCode !== 'BR' || !/^\d{8}$/.test(postalCode) || values.cityIbgeCode) return values;
    const version = ++postalLookupVersion.current;
    setPostalFeedback('Consultando CEP...');
    try {
      const address = await lookupBrazilianAddress(postalCode);
      if (version !== postalLookupVersion.current || form.getValues('postalCode').replace(/\D/g, '') !== postalCode || form.getValues('countryCode') !== 'BR') return values;
      if (!address) { setPostalFeedback('CEP não encontrado. Confira o número informado.'); return values; }
      const next = { ...values, street: address.street || values.street, district: address.district || values.district,
        cityName: address.cityName, stateCode: address.stateCode, cityIbgeCode: address.cityIbgeCode };
      for (const key of ['street', 'district', 'cityName', 'stateCode', 'cityIbgeCode'] as const) {
        form.setValue(key, next[key], { shouldDirty: true, shouldValidate: true });
      }
      setPostalFeedback('Endereço encontrado pelo CEP. Informe o número do imóvel.');
      return next;
    } catch {
      if (version === postalLookupVersion.current) setPostalFeedback('Não foi possível consultar o CEP agora.');
      return values;
    }
  }

  async function submit(values: Values) {
    try { await onSave(payload(await resolvePostalCode(values))); }
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

  function changeCountry(next: string) {
    if (next === country) return;
    postalLookupVersion.current += 1;
    setPostalFeedback('');
    form.setValue('countryCode', next, { shouldDirty: true });
    if (next !== 'BR') {
      form.setValue('postalCode', '', { shouldValidate: true });
      form.setValue('stateCode', '', { shouldValidate: true });
      form.setValue('cityIbgeCode', '', { shouldValidate: true });
    } else {
      form.setValue('foreignPostalCode', '', { shouldValidate: true });
      form.setValue('foreignStateProvince', '', { shouldValidate: true });
    }
  }

  return <div className="drawer-backdrop">
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
      <div className="drawer__header">
        <div><p className="eyebrow">CADASTRO DE CLIENTES</p><h2 id="customer-form-title">{customer ? 'Editar cliente' : 'Novo cliente'}</h2><p>Dados de identificação, contato e endereço.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar formulário"><X size={20} /></button>
      </div>
      <form id="customer-form" onSubmit={form.handleSubmit(submit)} noValidate>
        <div className="drawer__body customer-form__body">
          <div className="form-grid form-grid--two">
            <Field label="Nome" error={errors.name?.message}><Controller name="name" control={form.control} render={({ field }) => <input {...field} ref={(element) => { field.ref(element); nameRef.current = element; }} placeholder="Nome ou razão social" aria-invalid={!!errors.name} />} /></Field>
            <Field label="CPF/CNPJ" error={errors.taxId?.message}><Controller name="taxId" control={form.control} render={({ field }) => <input value={field.value} onChange={(event) => { const clean = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); field.onChange(formatTaxId(clean, clean.length > 11 || /[A-Z]/.test(clean) ? 'PJ' : 'PF')); }} onBlur={field.onBlur} placeholder="CPF ou CNPJ" inputMode="text" aria-invalid={!!errors.taxId} />} /></Field>
            <Field label="E-mail" error={errors.email?.message}><input type="email" placeholder="cliente@email.com" aria-invalid={!!errors.email} {...form.register('email')} /></Field>
            <Field label="Telefone / WhatsApp" error={errors.phone?.message}><Controller name="phone" control={form.control} render={({ field }) => <input value={field.value} onChange={(event) => field.onChange(formatPhone(event.target.value))} onBlur={field.onBlur} placeholder="(00) 00000-0000" inputMode="tel" aria-invalid={!!errors.phone} />} /></Field>
          </div>

          <div className="customer-form__address">
            <div className="form-grid form-grid--address">
            {foreignAddress ? <Field label="Código postal no exterior" error={errors.foreignPostalCode?.message}><input maxLength={11} placeholder="Ex.: SW1A 1AA" {...form.register('foreignPostalCode')} /></Field> : <Field label="CEP" error={errors.postalCode?.message} hint={postalFeedback}><Controller name="postalCode" control={form.control} render={({ field }) => <input value={field.value} onChange={(event) => { postalLookupVersion.current += 1; setPostalFeedback(''); field.onChange(formatPostalCode(event.target.value)); form.setValue('cityIbgeCode', '', { shouldDirty: true }); }} onBlur={() => { field.onBlur(); void resolvePostalCode(form.getValues()); }} placeholder="00000-000" inputMode="numeric" aria-invalid={!!errors.postalCode} />} /></Field>}
            <Field label="Logradouro" error={errors.street?.message}><input placeholder="Rua, avenida..." {...form.register('street')} /></Field>
            <Field label="Número" error={errors.number?.message}><input placeholder="Nº" {...form.register('number')} /></Field>
            <Field label="Complemento" error={errors.complement?.message}><input placeholder="Sala, bloco..." {...form.register('complement')} /></Field>
            <Field label="Bairro" error={errors.district?.message}><input placeholder="Bairro" {...form.register('district')} /></Field>
            <Field label="Cidade" error={errors.cityName?.message}><input placeholder="Cidade" {...form.register('cityName', { onChange: () => { postalLookupVersion.current += 1; form.setValue('cityIbgeCode', '', { shouldDirty: true }); } })} /></Field>
            {foreignAddress ? <Field label="Estado, província ou região" error={errors.foreignStateProvince?.message}><input maxLength={60} placeholder="Ex.: Ontário" {...form.register('foreignStateProvince')} /></Field> : <>
              <Field label="UF" error={errors.stateCode?.message}><Controller name="stateCode" control={form.control} render={({ field }) => <select {...field} aria-label="UF" onChange={(event) => { postalLookupVersion.current += 1; field.onChange(event); form.setValue('cityIbgeCode', '', { shouldDirty: true }); }} aria-invalid={!!errors.stateCode}><StateOptions value={field.value} /></select>} /></Field>
            </>}
            <Field label="País do endereço" error={errors.countryCode?.message} hint="Ao mudar o país, os dados postais do endereço anterior serão limpos."><span className="customer-form__country-control"><Globe2 size={17} aria-hidden="true" /><select value={country} onChange={event => changeCountry(event.target.value)} aria-invalid={!!errors.countryCode}><CountryOptions value={country} /></select></span></Field>
            </div>
          </div>

          {(foreignAddress || foreignTaxId || noForeignTaxIdReason) && <>
            <div className="form-grid form-grid--two">
              <Field label="Documento fiscal estrangeiro (NIF)" error={errors.foreignTaxId?.message} hint="Identificação fiscal fornecida pelo país do cliente."><Controller name="foreignTaxId" control={form.control} render={({ field }) => <input {...field} maxLength={40} onChange={event => { field.onChange(event); if (event.target.value.trim()) form.setValue('noForeignTaxIdReason', '', { shouldValidate: true }); }} />} /></Field>
              <Field label="Motivo de não possuir documento fiscal estrangeiro" error={errors.noForeignTaxIdReason?.message}><Controller name="noForeignTaxIdReason" control={form.control} render={({ field }) => <select {...field} onChange={event => { field.onChange(event); if (event.target.value) form.setValue('foreignTaxId', '', { shouldValidate: true }); }}><option value="">Não informado</option><option value="1">Dispensado desse documento</option><option value="2">O país não exige esse documento</option></select>} /></Field>
            </div>
          </>}

          <Field label="Observações" error={errors.notes?.message}><textarea rows={4} placeholder="Informações úteis para o atendimento..." {...form.register('notes')} /></Field>
        </div>
        {saveFeedback && <div className="drawer__save-feedback" role="alert">{saveFeedback}</div>}
        <div className="drawer__footer"><button type="button" className="button button--secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving}><Save size={17} />{saving ? 'Salvando...' : customer ? 'Salvar alterações' : 'Cadastrar cliente'}</button></div>
      </form>
    </aside>
  </div>;
}
