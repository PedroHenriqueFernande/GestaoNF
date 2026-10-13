import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, ExternalLink, Link2, LoaderCircle, MessageCircle, ShieldCheck, Smartphone, Unlink } from 'lucide-react';
import QRCode from 'qrcode';
import { api, type User, type WhatsAppLinkChallenge } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import './nilo.css';

type ChallengeOptions = { companyId: string; mode: 'NEW_NUMBER' | 'EXISTING_NUMBER'; linkId?: string };
type Pairing = { challenge: WhatsAppLinkChallenge; options: ChallengeOptions };
const phoneLabel = (phone: string | null) => phone ? `+${phone.replace(/\D/g, '')}` : 'Número verificado';

export function NiloPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [selectedNumber, setSelectedNumber] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [message, setMessage] = useState('');
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const companyName = companies.data?.find((company) => company.id === companyId)?.name ?? 'esta empresa';
  const challenge = pairing?.options.companyId === companyId ? pairing.challenge : null;

  useEffect(() => {
    if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? '');
  }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => {
    let active = true;
    setQrCode('');
    if (challenge) QRCode.toDataURL(challenge.waLink, { width: 280, margin: 1, color: { dark: '#102a37', light: '#ffffff' }, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setQrCode(value); }).catch(() => { if (active) setMessage('Não foi possível desenhar o QR Code. Use Abrir no WhatsApp.'); });
    return () => { active = false; };
  }, [challenge]);

  const status = useQuery({ queryKey: ['whatsapp-link', companyId], queryFn: () => api.whatsappLinkStatus(companyId), enabled: !!companyId });
  const numbers = status.data?.verifiedNumbers ?? [];
  const numberId = numbers.some((number) => number.id === selectedNumber) ? selectedNumber : numbers[0]?.id ?? '';
  const challengeStatus = useQuery({
    queryKey: ['whatsapp-challenge', companyId, challenge?.challengeId],
    queryFn: () => api.whatsappChallengeStatus(companyId, challenge!.challengeId), enabled: !!companyId && !!challenge,
    refetchInterval: (query) => ['PENDING', 'CANDIDATE'].includes(query.state.data?.status ?? 'PENDING') ? 2_000 : false,
  });
  const create = useMutation({
    mutationFn: ({ companyId: target, ...input }: ChallengeOptions) => api.createWhatsAppChallenge(target, input),
    onSuccess: (value, options) => { if (options.companyId === companyId) { setPairing({ challenge: value, options }); setMessage(''); } },
    onError: (error, options) => { if (options.companyId === companyId) setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o QR Code.'); },
  });
  const confirm = useMutation({
    mutationFn: (input: { companyId: string; challengeId: string }) => api.confirmWhatsAppLink(input.companyId, input.challengeId),
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-link'] });
      if (input.companyId === companyId) { setPairing(null); setMessage('WhatsApp vinculado a esta empresa. Os demais vínculos foram preservados.'); }
    },
    onError: (error, input) => { if (input.companyId === companyId) setMessage(error instanceof Error ? error.message : 'Não foi possível confirmar o vínculo.'); },
  });
  const disconnect = useMutation({
    mutationFn: (target: string) => api.disconnectWhatsApp(target),
    onSuccess: async (_, target) => {
      await queryClient.invalidateQueries({ queryKey: ['whatsapp-link'] });
      if (target === companyId) { setMessage('Vínculo removido somente desta empresa.'); setPairing(null); }
    },
    onError: (error, target) => { if (target === companyId) setMessage(error instanceof Error ? error.message : 'Não foi possível desconectar.'); },
  });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/nero'); } });
  function changeCompany(id: string) { setCompanyId(id); setPairing(null); setSelectedNumber(''); setMessage(''); }
  const candidate = challengeStatus.data?.status === 'CANDIDATE';
  const expired = ['EXPIRED', 'CANCELED'].includes(challengeStatus.data?.status ?? '');

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={changeCompany} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="nilo-workspace">
    <main id="workspace-main" className="nilo-main" tabIndex={-1}>
      <header className="nilo-header"><div><span>NERO / ASSISTENTE DE GESTÃO</span><h1>Seu secretário no WhatsApp</h1><p>Vincule seu número a cada empresa que deseja consultar. Use o mesmo WhatsApp em várias empresas ou um número diferente em cada uma.</p></div><div className="nilo-header__mark"><Bot size={34} /></div></header>
      <section className="nilo-grid">
        <article className="nilo-card nilo-card--primary">
          <div className="nilo-card__heading"><span className="nilo-card__icon"><MessageCircle size={20} /></span><div><h2>Conexão com o Nero</h2><p>Empresa: <strong>{companyName}</strong>. O vínculo permanece até você removê-lo.</p></div></div>
          {status.isPending ? <div className="nilo-loading"><LoaderCircle className="is-spinning" size={22} /> Verificando integração...</div>
            : status.isError ? <div className="nilo-unavailable"><h3>Não foi possível verificar o vínculo</h3><p>{status.error instanceof Error ? status.error.message : 'Tente novamente.'}</p><button className="button" type="button" onClick={() => status.refetch()}>Tentar novamente</button></div>
            : !status.data?.configured ? <div className="nilo-unavailable"><Smartphone size={28} /><h3>WhatsApp ainda não configurado</h3><p>Entre em contato com o administrador para configurar a conexão com o Nero.</p></div>
            : status.data.linked ? <div className="nilo-connected"><span><CheckCircle2 size={24} /></span><div><h3>WhatsApp vinculado a {companyName}</h3><p>{phoneLabel(status.data.link?.phoneE164 ?? null)}</p><small>Este vínculo pertence a esta empresa.</small></div><div className="nilo-connected__actions"><button type="button" onClick={() => disconnect.mutate(companyId)} disabled={disconnect.isPending}><Unlink size={15} /> Desconectar nesta empresa</button></div></div>
            : challenge ? <div className="nilo-pairing">
              <div className="nilo-qr">{expired ? <p>Este QR Code expirou ou foi cancelado.</p> : qrCode ? <img src={qrCode} alt={`QR Code para vincular seu WhatsApp à empresa ${companyName}`} /> : <LoaderCircle className="is-spinning" />}</div>
              <div className="nilo-pairing__copy"><span className="nilo-step">01</span><h3>Vincule à empresa {companyName}</h3><p>{pairing?.options.mode === 'EXISTING_NUMBER' ? `Envie a mensagem pelo número ${phoneLabel(numbers.find((number) => number.id === pairing.options.linkId)?.phoneE164 ?? null)}.` : 'Leia o QR Code com o número que deseja vincular e envie a mensagem preenchida.'}</p>{!expired && <a href={challenge.waLink} target="_blank" rel="noreferrer">Abrir no WhatsApp <ExternalLink size={14} /></a>}<span className="nilo-step">02</span><h3>Confirme no GestãoNF</h3><p>{candidate ? `Mensagem recebida de ${phoneLabel(challengeStatus.data?.candidatePhoneE164 ?? null)}. Confira o número e confirme o vínculo.` : expired ? 'Gere outro QR Code para continuar.' : 'Aguardando a mensagem chegar pelo WhatsApp.'}</p><button className="button button--primary" type="button" disabled={!candidate || expired || confirm.isPending} onClick={() => confirm.mutate({ companyId, challengeId: challenge.challengeId })}><ShieldCheck size={15} /> Confirmar este número</button><div className="nilo-pairing__actions"><button type="button" className="button" disabled={create.isPending} onClick={() => pairing && create.mutate(pairing.options)}>Gerar outro QR Code</button><button type="button" className="button" onClick={() => setPairing(null)}>Voltar</button></div></div>
            </div> : <div className="nilo-start"><div><Link2 size={30} /><h3>Vincule seu WhatsApp a {companyName}</h3><p>Confirme o vínculo nesta empresa. Suas conexões com outras empresas serão preservadas.</p></div>
              {numbers.length > 0 && <fieldset className="nilo-number-options"><legend>{numbers.length > 1 ? 'Escolha um dos seus números verificados' : 'Seu número verificado'}</legend>{numbers.map((number) => <label className="nilo-number-option" key={number.id}><input type="radio" name="nero-number" value={number.id} checked={numberId === number.id} onChange={() => setSelectedNumber(number.id)} /><span>{phoneLabel(number.phoneE164)}</span></label>)}</fieldset>}
              <div className="nilo-start__actions">{numbers.length > 0 && <button className="button button--primary" type="button" disabled={create.isPending || !numberId} onClick={() => create.mutate({ companyId, mode: 'EXISTING_NUMBER', linkId: numberId })}><Link2 size={16} /> Vincular este número também</button>}<button className={`button${numbers.length ? '' : ' button--primary'}`} type="button" disabled={create.isPending} onClick={() => create.mutate({ companyId, mode: 'NEW_NUMBER' })}>{create.isPending ? <LoaderCircle className="is-spinning" size={16} /> : <Smartphone size={16} />}{numbers.length ? 'Vincular outro número' : 'Gerar QR Code'}</button></div>
            </div>}
          {message && <p className="nilo-message" role="status">{message}</p>}
        </article>
        <aside className="nilo-card nilo-card--guide"><span>COMO FUNCIONA</span><h2>Um vínculo para cada empresa</h2><ol><li><b>1</b><div><strong>Empresa do QR Code</strong><p>A confirmação vincula seu número somente à empresa exibida.</p></div></li><li><b>2</b><div><strong>Mesmo número ou outro</strong><p>Você pode reutilizar seu WhatsApp em outra empresa ou conectar um número diferente.</p></div></li><li><b>3</b><div><strong>Escolha em cada pedido</strong><p>Se o mesmo número tiver várias empresas, Nero perguntará qual usar em cada nova solicitação.</p></div></li></ol><div className="nilo-security"><ShieldCheck size={18} /><p>Trocar a empresa no site não altera seus vínculos nem o pedido em andamento no WhatsApp.</p></div></aside>
      </section>
    </main>
  </WorkspaceLayout>;
}
