import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '../../api/client';
import { SupportText } from './SupportText';

export function HelpTopics({ companyId, onBack, onOpen }: { companyId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const topics = useQuery({ queryKey: ['support-help'], queryFn: () => api.supportHelpList(companyId), staleTime: 3600_000 });
  return <div className="support-help">
    <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={14} />Voltar</button>
    <div className="support-form__head"><h3>Como fazer...</h3><p className="support-muted">Escolha um assunto para ver o passo a passo.</p></div>
    {topics.isPending && <p className="support-muted">Carregando...</p>}
    {topics.isError && <p className="support-notice support-notice--error">{topics.error.message}</p>}
    <ul>{topics.data?.map((topic) => <li key={topic.id}><button type="button" className="support-topic" onClick={() => onOpen(topic.id)}><span>{topic.titulo}</span><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ul>
  </div>;
}

export function HelpArticleView({ companyId, id, onBack }: { companyId: string; id: string; onBack: () => void }) {
  const navigate = useNavigate();
  const article = useQuery({ queryKey: ['support-help', id], queryFn: () => api.supportHelp(companyId, id), staleTime: 3600_000 });
  return <div className="support-help">
    <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={14} />Voltar</button>
    {article.isPending && <p className="support-muted">Carregando...</p>}
    {article.isError && <p className="support-notice support-notice--error">{article.error.message}</p>}
    {article.data && <>
      <h3>{article.data.titulo}</h3>
      <article className="support-article"><SupportText text={article.data.conteudo} /></article>
      {article.data.to && <button type="button" className="support-link" onClick={() => navigate(article.data!.to!)}><span>Ir para a tela</span><ArrowRight size={14} /></button>}
    </>}
  </div>;
}
