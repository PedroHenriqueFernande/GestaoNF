import { api, type StoredFile, type UploadCapabilities } from '../../api/client';

function mimeFor(file: File): StoredFile['mimeType'] | null {
  const byExtension: Record<string, StoredFile['mimeType']> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
  const mime = file.type || byExtension[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return ['image/jpeg', 'image/png', 'application/pdf'].includes(mime) ? mime as StoredFile['mimeType'] : null;
}
export async function uploadFile(companyId: string, file: File, capabilities: UploadCapabilities, signal: AbortSignal, progress: (percent: number) => void) {
  const mimeType = mimeFor(file);
  if (!mimeType || !capabilities.mimeTypes.includes(mimeType)) throw new Error('Selecione um arquivo PNG, JPEG ou PDF.');
  const max = mimeType === 'application/pdf' ? capabilities.pdfMaxBytes : capabilities.imageMaxBytes;
  if (!file.size || file.size > max) throw new Error(mimeType === 'application/pdf' ? 'O PDF deve ter até 25 MB.' : 'A imagem deve ter até 10 MB.');
  signal.throwIfAborted();
  const session = await api.beginFileUpload(companyId, { fileName: file.name, mimeType, sizeBytes: file.size }, crypto.randomUUID());
  signal.throwIfAborted();
  if (session.upload) {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      const finish = (error?: Error) => { signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
      xhr.open('PUT', session.upload!.url);
      xhr.withCredentials = false;
      xhr.timeout = 120_000;
      for (const [name, value] of Object.entries(session.upload!.headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error('Não foi possível enviar o arquivo. Selecione-o novamente.'));
      xhr.onerror = () => finish(new Error('Falha na conexão durante o envio do arquivo.'));
      xhr.ontimeout = () => finish(new Error('O envio demorou demais. Tente novamente.'));
      xhr.onabort = () => finish(new DOMException('Envio cancelado', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      xhr.send(file);
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    progress(100);
    return api.completeFileUpload(companyId, session.file.id);
  }
  return session.file;
}
