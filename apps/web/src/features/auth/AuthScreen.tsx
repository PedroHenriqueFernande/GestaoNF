import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, FileCheck2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '../../api/client';
import { Brand } from '../../components/Brand';

const schema = z.object({
  name: z.string(),
  companyName: z.string(),
  email: z.email('Informe um e-mail válido.'),
  password: z.string().min(12, 'A senha deve ter pelo menos 12 caracteres.'),
});
type Values = z.infer<typeof schema>;

export function AuthScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: '', companyName: '', email: '', password: '' } });
  const mutation = useMutation({
    mutationFn: (values: Values) => mode === 'login'
      ? api.login(values.email, values.password)
      : api.register(values.name.trim(), values.email, values.password, values.companyName.trim()),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['me'] }); },
  });

  function changeMode(next: 'login' | 'register') {
    setMode(next);
    mutation.reset();
    form.clearErrors();
  }

  async function submit(values: Values) {
    if (mode === 'register') {
      if (!values.name.trim()) { form.setError('name', { message: 'Informe seu nome.' }); return; }
      if (!values.companyName.trim()) { form.setError('companyName', { message: 'Informe o nome da empresa.' }); return; }
    }
    await mutation.mutateAsync(values).catch(() => undefined);
  }

  return (
    <main className="auth-layout">
      <div className="auth-top"><Brand /></div>
      <section className="auth-shell" aria-label="Acesso ao GestãoNF">
        <div className="auth-intro">
          <div className="auth-eyebrow"><FileCheck2 size={16} /> GESTÃO ORGANIZADA</div>
          <h1>Seus clientes.<br /><span>Sua operação em ordem.</span></h1>
          <p>Um cadastro claro e confiável para acompanhar quem compra de você e preparar cada atendimento para a emissão fiscal.</p>
          <div className="auth-points">
            <div><ShieldCheck size={18} /><span>Dados separados por empresa</span></div>
            <div><FileCheck2 size={18} /><span>Cadastro pronto para crescer com sua gestão</span></div>
          </div>
        </div>
        <div className="auth-card">
          <div className="auth-card__icon"><LockKeyhole size={22} /></div>
          <p className="eyebrow">ACESSO AO SISTEMA</p>
          <h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Criar sua conta'}</h2>
          <p className="auth-card__hint">{mode === 'login' ? 'Entre para acessar o cadastro de clientes.' : 'Comece informando seus dados e o nome da sua empresa.'}</p>
          <form onSubmit={form.handleSubmit(submit)} noValidate>
            {mode === 'register' && <>
              <label className="field"><span>Seu nome <b>*</b></span><input autoComplete="name" placeholder="Nome completo" {...form.register('name')} aria-invalid={!!form.formState.errors.name} />{form.formState.errors.name && <small className="field-error">{form.formState.errors.name.message}</small>}</label>
              <label className="field"><span>Nome da empresa <b>*</b></span><input autoComplete="organization" placeholder="Como sua empresa é conhecida" {...form.register('companyName')} aria-invalid={!!form.formState.errors.companyName} />{form.formState.errors.companyName && <small className="field-error">{form.formState.errors.companyName.message}</small>}</label>
            </>}
            <label className="field"><span>E-mail <b>*</b></span><input type="email" autoComplete="email" placeholder="voce@empresa.com.br" {...form.register('email')} aria-invalid={!!form.formState.errors.email} />{form.formState.errors.email && <small className="field-error">{form.formState.errors.email.message}</small>}</label>
            <label className="field"><span>Senha <b>*</b></span><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Mínimo de 12 caracteres" {...form.register('password')} aria-invalid={!!form.formState.errors.password} />{form.formState.errors.password && <small className="field-error">{form.formState.errors.password.message}</small>}</label>
            {mutation.isError && <div className="inline-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'Não foi possível continuar.'}</div>}
            <button className="button button--primary auth-submit" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Aguarde...' : mode === 'login' ? 'Entrar no GestãoNF' : 'Criar conta'}<ArrowRight size={17} /></button>
          </form>
          <div className="auth-switch">{mode === 'login' ? 'Ainda não tem uma conta?' : 'Já tem uma conta?'} <button type="button" onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</button></div>
        </div>
      </section>
      <footer className="auth-footer">GestãoNF · Gestão com clareza</footer>
    </main>
  );
}
