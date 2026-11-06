import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ProposalsService } from './proposals.service.js';
import type { CrmContext } from './crm.schemas.js';

@Injectable()
export class ProposalDocumentService {
  constructor(@Inject(ProposalsService) private readonly proposals: ProposalsService) {}
  async pdf(ctx: CrmContext, id: string) {
    const { snapshot: s, draft } = await this.proposals.preview(ctx, id);
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true,
      info: { Title: `${s.proposalCode} — ${s.title}`, Author: s.issuer.name, CreationDate: new Date(s.issuedAt), ModDate: new Date(s.issuedAt) } });
    const chunks: Buffer[] = [];
    const output = new Promise<Buffer>((resolve, reject) => { doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const money = (v: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v));
    const section = (title: string, value: string | null) => {
      if (!value) return;
      doc.moveDown().font('Helvetica-Bold').fontSize(11).fillColor('#164b60').text(title);
      doc.font('Helvetica').fontSize(10).fillColor('#243746').text(value, { lineGap: 3 });
    };
    doc.font('Helvetica-Bold').fontSize(21).fillColor('#164b60').text(s.issuer.legalName ?? s.issuer.name);
    if (s.issuer.taxId) doc.font('Helvetica').fontSize(9).fillColor('#657a89').text(`CPF/CNPJ: ${s.issuer.taxId}`);
    doc.moveDown().font('Helvetica-Bold').fontSize(17).fillColor('#243746').text(s.title);
    doc.font('Helvetica').fontSize(10).text(`Proposta ${s.proposalCode}${draft ? ' · RASCUNHO' : ''}`);
    section('Destinatário', [s.recipient.name, s.recipient.organization, s.recipient.taxId ? `CPF/CNPJ: ${s.recipient.taxId}` : null, s.recipient.email].filter(Boolean).join('\n'));
    section('Apresentação', s.commercialDescription);
    doc.moveDown().font('Helvetica-Bold').fontSize(11).fillColor('#164b60').text('Serviços e valores');
    for (const [i, item] of s.items.entries()) {
      doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10).fillColor('#243746').text(`${i + 1}. ${item.serviceNameSnapshot}`);
      if (item.descriptionSnapshot) doc.font('Helvetica').fontSize(9).text(item.descriptionSnapshot, { lineGap: 2 });
      doc.font('Helvetica').fontSize(9).text(`Quantidade: ${Number(item.quantity).toLocaleString('pt-BR')} ${item.unitLabelSnapshot} · Unitário: ${money(item.unitPrice)} · Desconto: ${money(item.discountAmount)}`);
      doc.font('Helvetica-Bold').text(`Total: ${money(item.totalAmount)}`);
    }
    section('Resumo', `Valor bruto: ${money(s.subtotalAmount)}\nDesconto: ${money(s.discountAmount)}\nTotal da proposta: ${money(s.totalAmount)}`);
    section('Condições de pagamento', s.paymentTerms);
    section('Validade', s.validUntil ? s.validUntil.split('-').reverse().join('/') : 'Sem prazo de validade informado');
    section('Observações', s.notes); section('Termos e condições', s.terms);
    const range = doc.bufferedPageRange();
    for (let p = range.start; p < range.start + range.count; p++) {
      doc.switchToPage(p);
      if (draft) {
        doc.save().opacity(0.09).fillColor('#164b60').font('Helvetica-Bold').fontSize(65).text('RASCUNHO', 65, 380, { lineBreak: false }); doc.restore();
      }
      doc.font('Helvetica').fontSize(8).fillColor('#657a89').text(`${s.proposalCode} · ${p + 1}/${range.count}`, 48, doc.page.height - 32, { lineBreak: false, width: doc.page.width - 96, align: 'right' });
    }
    doc.end(); return { bytes: await output, filename: `${s.proposalCode}${draft ? '-rascunho' : ''}.pdf` };
  }
}
