import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy, MessageCircleQuestion, RotateCcw, Send, X } from 'lucide-react';
import { api, type SupportMessage } from '../../api/client';
import { QuickActions } from './QuickActions';
import { ReportPdfForm } from './ReportPdfForm';
import { SupportBlocks } from './SupportBlocks';
import { HelpArticleView, HelpTopics } from './SupportHelp';
import { SupportText } from './SupportText';

type View = 'chat' | 'report' | 'topics' | { article: string };

export function SupportPanel({ companyId, userId, closing, onClose }: { companyId: string; userId: string; closing: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = ['support-conversation', userId, companyId];
  const conversation = useQuery({ queryKey: key, queryFn: () => api.supportConversation(companyId) });
  const [view, setView] = useState<View>('chat');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  const focused = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  // Quando o elemento focado some da tela (troca de visão, cartão confirmado), o foco volta ao painel.
  const restoreFocus = (preferInput = false) => window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (preferInput && inputRef.current && !inputRef.current.disabled) inputRef.current.focus();
    else panelRef.current?.focus();
  });
  const send = useMutation({ mutationFn: (value: string) => api.supportSend(companyId, value), onSuccess: (result) => { setText(''); setAnnouncement(announce(result.messages)); return refresh(); }, onSettled: () => restoreFocus(true) });
  const reset = useMutation({ mutationFn: () => api.supportReset(companyId), onSuccess: () => { send.reset(); setText(''); setView('chat'); setAnnouncement(''); return refresh(); } });
  const messages = conversation.data?.conversation?.messages ?? [];
  const aiEnabled = conversation.data?.aiEnabled ?? false;
  const empty = !conversation.isPending && !messages.length && !send.isPending;

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length, send.isPending, view]);
  // Foco: o painel recebe o foco ao abrir; quando a conversa carrega, vai para o campo de mensagem (ou para o título, sem IA).
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    if (conversation.isPending || focused.current) return;
    focused.current = true;
    if (aiEnabled && inputRef.current) inputRef.current.focus();
    else titleRef.current?.focus();
  }, [conversation.isPending, aiEnabled]);
  useEffect(() => { if (focused.current) restoreFocus(true); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }, [text, view]);

  // Esc só fecha quando o foco está no painel; modais da página tratam o próprio Esc.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented) onClose();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (value && aiEnabled && !send.isPending && !reset.isPending) send.mutate(value);
  }
  const prompt = (value: string) => { setView('chat'); if (aiEnabled && !send.isPending && !reset.isPending) send.mutate(value); };
  const shortcuts = (layout: 'list' | 'chips') => <QuickActions aiEnabled={aiEnabled} layout={layout} onReport={() => setView('report')} onTopics={() => setView('topics')} onPrompt={prompt} />;

  return <aside id="support-panel" ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown} className="support-panel" data-state={closing ? 'closed' : 'open'} role="dialog" aria-label="Ajuda do GestãoNF">
    <header className="support-panel__header">
      <span className="support-panel__mark" aria-hidden="true"><LifeBuoy size={20} /></span>
      <div className="support-panel__title"><strong ref={titleRef} tabIndex={-1}>Ajuda do GestãoNF</strong><span>{aiEnabled ? 'Assistente de suporte' : 'Atalhos de ajuda'}</span></div>
      <div className="support-panel__tools">
        <button type="button" className="support-tool" aria-label="Nova conversa" title="Nova conversa" disabled={reset.isPending || send.isPending || !messages.length} onClick={() => reset.mutate()}><RotateCcw size={16} /></button>
        <button type="button" className="support-tool" aria-label="Fechar ajuda" title="Fechar" onClick={onClose}><X size={18} /></button>
      </div>
    </header>
    <div className="support-sr" role="status" aria-live="polite">{announcement}</div>
    {view === 'report' ? <div className="support-body"><ReportPdfForm companyId={companyId} onBack={() => setView('chat')} /></div>
      : view === 'topics' ? <div className="support-body"><HelpTopics companyId={companyId} onBack={() => setView('chat')} onOpen={(id) => setView({ article: id })} /></div>
      : typeof view === 'object' ? <div className="support-body"><HelpArticleView companyId={companyId} id={view.article} onBack={() => setView('topics')} /></div>
      : <>
        <div className="support-messages support-body" ref={listRef}>
          {conversation.isPending && <p className="support-muted">Carregando...</p>}
          {conversation.isError && <div className="support-notice support-notice--error" role="alert">Não foi possível carregar a conversa. <button type="button" className="support-link" onClick={() => conversation.refetch()}>Tentar novamente</button></div>}
          {empty && <div className="support-empty">
            <span className="support-empty__icon" aria-hidden="true"><MessageCircleQuestion size={26} /></span>
            <h3>Como posso ajudar?</h3>
            <p>{aiEnabled ? 'Escreva sua dúvida ou use um atalho.' : 'Use um dos atalhos abaixo.'}</p>
            {shortcuts('list')}
          </div>}
          {messages.map((message) => <div key={message.id} className={`support-message support-message--${message.role}`}>
            <SupportBlocks companyId={companyId} blocks={message.blocks} onActionSettled={() => refresh().finally(() => restoreFocus())} />
          </div>)}
          {send.isPending && <>
            <div className="support-message support-message--user"><SupportText text={send.variables ?? ''} /></div>
            <div className="support-message support-message--assistant support-typing" role="status" aria-label="Assistente digitando"><span /><span /><span /></div>
          </>}
          {send.isError && <p className="support-notice support-notice--error" role="alert">{send.error.message}</p>}
          {reset.isError && <p className="support-notice support-notice--error" role="alert">{reset.error.message}</p>}
        </div>
        {!empty && !conversation.isPending && shortcuts('chips')}
        <form className="support-input" onSubmit={submit}>
          <textarea ref={inputRef} aria-label="Mensagem para o assistente" placeholder={aiEnabled ? 'Escreva sua dúvida...' : 'Chat com IA desativado'} disabled={!aiEnabled || send.isPending || reset.isPending}
            maxLength={1000} rows={1} value={text} onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button className="button button--primary button--icon support-send" aria-label="Enviar" disabled={!aiEnabled || send.isPending || reset.isPending || !text.trim()}><Send size={16} /></button>
        </form>
      </>}
  </aside>;
}

function announce(messages: SupportMessage[]) {
  const reply = messages.find((message) => message.role === 'assistant');
  const parts = (reply?.blocks ?? []).flatMap((block) => block.type === 'text' || block.type === 'notice' ? [block.text.replace(/\*\*|^#+\s|^\s*[-*•]\s|^\s*\d+[.)]\s/gm, '')] : block.type === 'action' ? ['Cadastro aguardando sua confirmação.'] : []);
  return parts.join(' ') || 'Resposta do assistente recebida.';
}
