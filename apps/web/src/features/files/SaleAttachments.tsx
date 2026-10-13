import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Image, LoaderCircle, Paperclip, X } from 'lucide-react';
import { api, type StoredFile } from '../../api/client';
import { uploadFile } from './upload-file';
import './files.css';

export function SaleAttachments({ companyId, files, onChange, onBusyChange, disabled }: {
  companyId: string; files: StoredFile[]; onChange: (files: StoredFile[]) => void; onBusyChange: (busy: boolean) => void; disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [uploading, setUploading] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState('');
  const capabilities = useQuery({ queryKey: ['file-capabilities', companyId], queryFn: () => api.fileCapabilities(companyId), enabled: !!companyId });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  async function selected(selection: FileList | null) {
    if (!selection || !capabilities.data?.enabled || busyRef.current || disabled) return;
    const chosen = [...selection];
    if (input.current) input.current.value = '';
    setError('');
    if (files.length + chosen.length > capabilities.data.maxAttachments) { setError('Você pode anexar até 10 arquivos por venda.'); return; }
    const abort = new AbortController(); controller.current = abort; busyRef.current = true; onBusyChange(true);
    let current = [...files];
    try {
      for (const file of chosen) {
        setUploading(file.name); setProgress(0);
        const uploaded = await uploadFile(companyId, file, capabilities.data, abort.signal, value => { if (mounted.current) setProgress(value); });
        abort.signal.throwIfAborted();
        current = [...current, uploaded]; onChange(current);
      }
    } catch (cause) {
      if (mounted.current && !abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível anexar o arquivo.');
    } finally {
      busyRef.current = false;
      if (mounted.current) { setUploading(''); onBusyChange(false); }
    }
  }
  async function download(file: StoredFile) {
    setDownloading(file.id); setError('');
    try {
      const access = await api.fileAccess(companyId, file.id);
      if (!mounted.current) return;
      const anchor = document.createElement('a'); anchor.href = access.url; anchor.download = access.fileName; anchor.referrerPolicy = 'no-referrer';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível baixar o arquivo.'); }
    finally { if (mounted.current) setDownloading(''); }
  }
  return <div className="sale-attachments" aria-label="Anexos da venda">
    <div className="sale-attachments__input">
      <input ref={input} type="file" multiple accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf" hidden aria-label="Selecionar anexos da venda" onChange={event => void selected(event.target.files)} />
      <button type="button" className="sale-attachments__add" onClick={() => input.current?.click()} disabled={disabled || !!uploading || !capabilities.data?.enabled || files.length >= 10}>
        <Paperclip size={14} /> Anexar arquivo
      </button>
      <small>PNG, JPEG ou PDF</small>
    </div>
    {files.length > 0 && <ul className="sale-attachments__list">{files.map(file => <li key={file.id}>
      {file.mimeType === 'application/pdf' ? <FileText size={14} /> : <Image size={14} />}
      <span title={file.fileName}>{file.fileName}</span>
      <button type="button" onClick={() => void download(file)} disabled={!!downloading} aria-label={`Baixar ${file.fileName}`} title="Baixar arquivo">{downloading === file.id ? <LoaderCircle className="is-spinning" size={14} /> : <Download size={14} />}</button>
      <button type="button" onClick={() => onChange(files.filter(entry => entry.id !== file.id))} disabled={disabled || !!uploading} aria-label={`Remover ${file.fileName}`} title="Remover anexo ao salvar a venda"><X size={13} /></button>
    </li>)}</ul>}
    {uploading && <p className="sale-attachments__progress" role="status"><LoaderCircle className="is-spinning" size={13} /><span>{progress < 100 ? `Enviando ${uploading}: ${progress}%` : `Validando ${uploading}…`}</span></p>}
    {capabilities.data && !capabilities.data.enabled && <p className="sale-attachments__hint">O envio de arquivos ainda não está disponível.</p>}
    {capabilities.isError && <p className="sale-attachments__error" role="alert">Não foi possível verificar o envio de arquivos. <button type="button" onClick={() => void capabilities.refetch()}>Tentar novamente</button></p>}
    {error && <p className="sale-attachments__error" role="alert">{error}</p>}
  </div>;
}
