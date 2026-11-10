import PDFDocument from 'pdfkit';

export type PdfFormat = 'text' | 'money' | 'date' | 'instant' | 'status' | 'items' | 'percent' | 'number';
export type PdfColumn = { key: string; label: string; weight: number; format?: PdfFormat };
export type ReportPdfInput = {
  title: string; companyName: string; periodLabel: string; generatedAt: Date; timezone: string;
  summary: { label: string; value: string }[]; columns: PdfColumn[]; rows: Record<string, unknown>[];
};

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', SCHEDULED: 'Agendada', COMPLETED: 'Realizada', CANCELED: 'Cancelada', NO_SHOW: 'Não compareceu',
  RECEIPT: 'Recebimento', REVERSAL: 'Estorno', MANUAL: 'Manual', FORM: 'Formulário', META_ADS: 'Meta Ads', GOOGLE_ADS: 'Google Ads',
  IMPORT: 'Importação', NERO: 'Nero', API: 'Integração', NEW: 'Novo', CONTACTING: 'Em contato', QUALIFIED: 'Qualificado',
  DISQUALIFIED: 'Desqualificado', LOST: 'Perdido', WON: 'Ganho', PF: 'Pessoa física', PJ: 'Pessoa jurídica', ONLINE: 'Online',
  IN_PERSON: 'Presencial', PIX: 'Pix', CASH: 'Dinheiro', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito',
  BOLETO: 'Boleto', TRANSFER: 'Transferência', OTHER: 'Outro',
};
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const winAnsiExtras = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Helvetica (fonte padrão do PDF) só desenha WinAnsi/Windows-1252; o resto vira '?' (um por caractere, emoji incluso). */
export function winAnsiSafe(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || winAnsiExtras.has(char)) out += char;
    else if (char === '\t' || char === '\r') out += ' ';
    else out += '?';
  }
  return out;
}

export function formatCell(value: unknown, format: PdfFormat = 'text', timezone: string): string {
  return winAnsiSafe(rawCell(value, format, timezone));
}

function rawCell(value: unknown, format: PdfFormat, timezone: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'money': return brl.format(Number(value));
    case 'date': return String(value).slice(0, 10).split('-').reverse().join('/');
    case 'instant': return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(String(value)));
    case 'status': return statusLabels[String(value)] ?? String(value);
    case 'items': return Array.isArray(value) ? value.map((item: { name?: unknown; quantity?: unknown }) => `${String(item.name)} (${Number(item.quantity).toLocaleString('pt-BR')})`).join(', ') || '—' : String(value);
    case 'percent': return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    case 'number': return Number(value).toLocaleString('pt-BR');
    default: return String(value);
  }
}

export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: `${input.title} — ${input.companyName}`, Author: 'GestãoNF' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = 32, width = pdf.page.width - 64, bottom = () => pdf.page.height - 48;
    pdf.font('Helvetica-Bold').fontSize(16).fillColor('#102a37').text(winAnsiSafe(input.title), left, 32, { width });
    pdf.font('Helvetica').fontSize(9).fillColor('#4b5a63')
      .text(winAnsiSafe(`${input.companyName} · ${input.periodLabel} · Gerado em ${formatCell(input.generatedAt.toISOString(), 'instant', input.timezone)}`), left, pdf.y + 2, { width });

    const boxWidth = Math.min(160, width / Math.max(1, input.summary.length));
    const boxTop = pdf.y + 12;
    input.summary.forEach((item, index) => {
      const x = left + index * boxWidth;
      pdf.roundedRect(x, boxTop, boxWidth - 8, 42, 4).lineWidth(0.7).strokeColor('#d5dee3').stroke();
      pdf.font('Helvetica').fontSize(7.5).fillColor('#5c6973').text(winAnsiSafe(item.label.toUpperCase()), x + 8, boxTop + 7, { width: boxWidth - 24, lineBreak: false, ellipsis: true });
      pdf.font('Helvetica-Bold').fontSize(11).fillColor('#102a37').text(winAnsiSafe(item.value), x + 8, boxTop + 21, { width: boxWidth - 24, lineBreak: false, ellipsis: true });
    });
    pdf.y = boxTop + (input.summary.length ? 56 : 0);

    const totalWeight = input.columns.reduce((sum, column) => sum + column.weight, 0);
    const widths = input.columns.map((column) => (width * column.weight) / totalWeight);
    const header = () => {
      const y = pdf.y;
      pdf.rect(left, y, width, 18).fill('#eef3f5');
      let x = left;
      pdf.font('Helvetica-Bold').fontSize(7.5).fillColor('#35434d');
      input.columns.forEach((column, index) => { pdf.text(column.label, x + 4, y + 5, { width: widths[index] - 8, lineBreak: false, ellipsis: true }); x += widths[index]; });
      pdf.y = y + 18;
    };
    header();
    if (!input.rows.length) {
      pdf.font('Helvetica').fontSize(9).fillColor('#5c6973').text('Nenhum registro encontrado para os filtros escolhidos.', left, pdf.y + 10, { width });
    }
    for (const row of input.rows) {
      pdf.font('Helvetica').fontSize(8);
      const cells = input.columns.map((column) => formatCell(row[column.key], column.format, input.timezone));
      const height = Math.max(16, ...cells.map((cell, index) => pdf.heightOfString(cell, { width: widths[index] - 8 }) + 8));
      if (pdf.y + height > bottom()) { pdf.addPage(); pdf.y = 32; header(); pdf.font('Helvetica').fontSize(8); }
      const y = pdf.y;
      let x = left;
      pdf.fillColor('#1f2a30');
      cells.forEach((cell, index) => { pdf.text(cell, x + 4, y + 4, { width: widths[index] - 8 }); x += widths[index]; });
      pdf.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.5).strokeColor('#e3e9ec').stroke();
      pdf.y = y + height;
    }

    const range = pdf.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      pdf.switchToPage(range.start + index);
      const margin = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0;
      pdf.font('Helvetica').fontSize(7.5).fillColor('#8a969d')
        .text(`GestãoNF · Página ${index + 1} de ${range.count}`, left, pdf.page.height - 28, { width, align: 'right', lineBreak: false });
      pdf.page.margins.bottom = margin;
    }
    pdf.end();
  });
}
