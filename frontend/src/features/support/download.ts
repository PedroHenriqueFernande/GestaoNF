export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportPdfFilename(type: string, from?: string, to?: string) {
  return `${type}${from && to ? `-${from}-a-${to}` : ''}.pdf`;
}
