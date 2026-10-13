import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, CheckCircle2, Clock3, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { api, type InvitationPreview } from '../../api/client';
import { Brand } from '../../components/Brand';
import './users.css';

function tokenFromFragment() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}

export function AcceptInvitationPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [token] = useState(tokenFromFragment);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [email, setEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const previewStarted = useRef(false);
  const previewRequest = useMutation({ mutationFn: api.previewInvitation, onSuccess: setPreview, onError: (cause) => setPreviewError(cause instanceof Error ? cause.message : 'Este convite não está disponível.') });
  useEffect(() => { document.title = 'GestãoNF · Aceitar convite'; if (token && !previewStarted.current) { previewStarted.current = true; previewRequest.mutate(token); } }, [token]);
  const accept = useMutation({
    mutationFn: async () => {
      if (preview?.nextStep === 'DEFINE_PASSWORD') return api.acceptNewInvitation(token, password, confirmation);
      await api.login(email.trim(), loginPassword);
      return api.acceptExistingInvitation(token);
    },
    onSuccess: async () => {
      setDone(true);
      window.history.replaceState(null, '', '/aceitar-convite');
      if (preview?.companies[0]) sessionStorage.setItem('gestaonf.companyId', preview.companies[0].id);
      client.clear();
      await client.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível aceitar o convite.'),
  });
  function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!preview) return;
    if (preview.nextStep === 'DEFINE_PASSWORD' && (password.length < 12 || password !== confirmation)) { setError(password.length < 12 ? 'Use uma senha com pelo menos 12 caracteres.' : 'As senhas precisam ser iguais.'); return; }
    if (preview.nextStep === 'LOGIN' && (!email.trim() || !loginPassword)) { setError('Informe o e-mail convidado e sua senha.'); return; }
    accept.mutate();
  }
  return <main className="invite-page"><header className="invite-page__header"><Brand /><span>CONVITE PARA EQUIPE</span></header><div className="invite-page__canvas"><section className="invite-page__story"><div className="invite-page__eyebrow"><ShieldCheck size={17} /> ACESSO À EMPRESA</div><h1>Seu lugar na<br /><em>equipe está pronto.</em></h1><p>Um convite para trabalhar com as informações da empresa em um só lugar.</p><div className="invite-page__rule"><span>01</span><strong>Confira as empresas</strong><span>02</span><strong>Confirme seu acesso</strong><span>03</span><strong>Comece a trabalhar</strong></div></section><section className="invite-card" aria-live="polite"><div className="invite-card__mark"><Mail size={23} /></div>
      {!token ? <><p className="eyebrow">LINK INCOMPLETO</p><h2>Não encontramos o convite</h2><p>Abra o link completo recebido no e-mail. Se o problema continuar, peça um novo convite ao titular da empresa.</p><Link className="button button--secondary" to="/Clientes">Ir para o sistema</Link></> : previewRequest.isPending && !preview ? <><p className="eyebrow">VERIFICANDO CONVITE</p><h2>Um instante...</h2><p>Estamos conferindo os dados e a validade deste link.</p></> : previewError ? <><p className="eyebrow">CONVITE INDISPONÍVEL</p><h2>Este link não pode ser usado</h2><p>{previewError}</p><p>O titular pode gerar outro convite para você.</p><Link className="button button--secondary" to="/Clientes">Ir para o sistema</Link></> : done ? <><CheckCircle2 className="invite-card__success" size={33} /><p className="eyebrow">ACESSO LIBERADO</p><h2>Você já faz parte da equipe</h2><p>Suas empresas estão disponíveis no GestãoNF.</p><button className="button button--primary invite-card__submit" type="button" onClick={() => navigate('/Clientes', { replace: true })}>Entrar no sistema <ArrowRight size={17} /></button></> : preview && <><p className="eyebrow">CONVITE DE {preview.accountName.toUpperCase()}</p><h2>Olá, {preview.name}</h2><p>Você foi convidado para acessar {preview.companies.length === 1 ? 'esta empresa' : 'estas empresas'} no GestãoNF.</p><div className="invite-card__summary"><span><Building2 size={16} /> Empresas</span><div>{preview.companies.map((company) => <strong key={company.id}>{company.name}</strong>)}</div><small><Clock3 size={13} /> Válido até {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(preview.expiresAt))}</small></div>
        {preview.nextStep === 'DEFINE_PASSWORD' ? <><h3>Defina sua senha</h3><p className="invite-card__help">Seu usuário será criado ao confirmar este convite. O endereço convidado é {preview.email}.</p><form onSubmit={submit}><label className="field"><span>Nova senha</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Pelo menos 12 caracteres" required /></label><label className="field"><span>Confirmar senha</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Repita sua senha" required /></label>{error && <div className="inline-error" role="alert">{error}</div>}<button className="button button--primary invite-card__submit" type="submit" disabled={accept.isPending}><LockKeyhole size={16} /> {accept.isPending ? 'Confirmando...' : 'Criar conta e aceitar convite'}</button></form></> : <><h3>Entre com sua conta</h3><p className="invite-card__help">Use o e-mail convidado ({preview.email}) e a senha que você já usa no GestãoNF.</p><form onSubmit={submit}><label className="field"><span>E-mail</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Seu e-mail de acesso" required /></label><label className="field"><span>Senha</span><input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label>{error && <div className="inline-error" role="alert">{error}</div>}<button className="button button--primary invite-card__submit" type="submit" disabled={accept.isPending}><LockKeyhole size={16} /> {accept.isPending ? 'Confirmando...' : 'Entrar e aceitar convite'}</button></form></>}
      </>}
    </section></div><footer className="invite-page__footer">GestãoNF · Gestão com clareza</footer></main>;
}
