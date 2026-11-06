export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function renderEmail(companyName: string, subject: string, message: string) {
  const text = `${companyName}\n\n${subject}\n\n${message}\n\nEnviado pelo GestãoNF.`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="margin:0;background:#f3f6f8;font-family:Arial,sans-serif;color:#172c3b"><table role="presentation" style="width:100%;padding:28px"><tr><td><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:white;padding:32px;border-top:4px solid #126b82"><tr><td><p style="color:#126b82;font-weight:bold">${escapeEmailHtml(companyName)}</p><h1 style="font-size:22px">${escapeEmailHtml(subject)}</h1><p style="font-size:16px;line-height:1.6">${escapeEmailHtml(message).replace(/\n/g, '<br>')}</p><p style="font-size:12px;color:#657a88;margin-top:28px">Enviado pelo GestãoNF.</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}
