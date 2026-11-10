export function putAvatar(file: File, upload: { url: string; method: 'PUT'; headers: Record<string, string> }, onProgress: (percent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) { reject(new DOMException('Envio cancelado', 'AbortError')); return; }
    signal.addEventListener('abort', abort, { once: true });
    xhr.open(upload.method, upload.url);
    xhr.timeout = 120_000;
    for (const [key, value] of Object.entries(upload.headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => { signal.removeEventListener('abort', abort); xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Não foi possível enviar a imagem. Tente novamente.')); };
    xhr.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('Não foi possível enviar a imagem. Tente novamente.')); };
    xhr.ontimeout = () => { signal.removeEventListener('abort', abort); reject(new Error('O envio da imagem demorou demais. Tente novamente.')); };
    xhr.onabort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Envio cancelado', 'AbortError')); };
    xhr.send(file);
  });
}
