import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, FileDown, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api, type SupportActionBlock, type SupportBlock } from '../../api/client';
import { saveBlob } from './download';
import { SupportText } from './SupportText';

type Props = { companyId: string; onActionSettled: () => void };
// Listas e seletores de clientes/serviços usados pelas telas (prefixos de queryKey).
const refreshKeys: Record<SupportActionBlock['kind'], string[]> = {
  CREATE_CUSTOMER: ['customers', 'sales-customers', 'proposal-customers', 'report', 'report-options'],
  CREATE_SERVICE: ['services', 'sales-services', 'crm-services', 'fiscal-services', 'report', 'report-options'],
};
const statusText: Record<SupportActionBlock['status'], string> = {
  PENDING: 'Aguardando sua confirmação', CONFIRMED: 'Cadastro concluído', CANCELED: 'Cancelado',
  EXPIRED: 'Expirado. Peça novamente ao assistente.', FAILED: 'Não foi possível concluir',
};

export function SupportBlocks({ blocks, ...props }: Props & { blocks: SupportBlock[] }) {
  return <>{blocks.map((block, index) => <BlockView key={block.type === 'action' ? block.actionId : index} block={block} {...props} />)}</>;
}

function BlockView({ block, companyId, onActionSettled }: Props & { block: SupportBlock }) {
  switch (block.type) {
    case 'text': return <SupportText text={block.text} />;
    case 'notice': return <p className={`support-notice support-notice--${block.level}`} role={block.level === 'error' ? 'alert' : 'status'}>{block.text}</p>;
    case 'navigate': return <NavigateButton to={block.to} label={block.label} />;
    case 'download': return <DownloadButton companyId={companyId} url={block.url} label={block.label} filename={block.filename} />;
    case 'action': return <ActionCard companyId={companyId} block={block} onActionSettled={onActionSettled} />;
  }
}

function NavigateButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <button type="button" className="support-link" onClick={() => navigate(to)}><span>{label}</span><ArrowRight size={14} /></button>;
}

function DownloadButton({ companyId, url, label, filename }: { companyId: string; url: string; label: string; filename: string }) {
  const download = useMutation({ mutationFn: () => api.supportDownload(companyId, url), onSuccess: (blob) => saveBlob(blob, filename) });
  return <>
    <button type="button" className="support-link" disabled={download.isPending} onClick={() => download.mutate()}><FileDown size={14} /><span>{download.isPending ? 'Gerando PDF...' : label}</span></button>
    {download.isError && <p className="support-notice support-notice--error" role="alert">{download.error.message}</p>}
  </>;
}

function ActionCard({ companyId, block, onActionSettled }: Props & { block: SupportActionBlock }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api.supportConfirm(companyId, block.actionId),
    onSuccess: (result) => {
      if (result.block.status === 'CONFIRMED') refreshKeys[block.kind].forEach((key) => queryClient.invalidateQueries({ queryKey: [key, companyId] }));
    },
    onSettled: onActionSettled,
  });
  const cancel = useMutation({ mutationFn: () => api.supportCancel(companyId, block.actionId), onSettled: onActionSettled });
  const busy = confirm.isPending || cancel.isPending;
  const customer = block.kind === 'CREATE_CUSTOMER';
  const title = customer ? 'Novo cliente' : 'Novo serviço';
  const Icon = customer ? UserPlus : ClipboardList;
  const error = confirm.error ?? cancel.error;
  return <section className={`support-action support-action--${block.status.toLowerCase()}`} aria-label={title}>
    <header>
      <span className="support-action__icon" aria-hidden="true"><Icon size={16} /></span>
      <div><strong>{title}</strong><span>{statusText[block.status]}</span></div>
    </header>
    <dl>{block.summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    {block.status === 'FAILED' && block.errorMessage && <p className="support-notice support-notice--error">{block.errorMessage}</p>}
    {error && <p className="support-notice support-notice--error" role="alert">{error.message}</p>}
    {block.status === 'PENDING' && <div className="support-action__buttons">
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => cancel.mutate()}>Cancelar</button>
      <button type="button" className="button button--primary" disabled={busy} onClick={() => confirm.mutate()}>{confirm.isPending ? 'Salvando...' : 'Confirmar'}</button>
    </div>}
    {block.status === 'CONFIRMED' && block.resultTo && <button type="button" className="support-link" onClick={() => navigate(block.resultTo!)}><span>Abrir cadastro</span><ArrowRight size={14} /></button>}
  </section>;
}
