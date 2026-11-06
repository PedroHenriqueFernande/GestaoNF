import PDFDocument from 'pdfkit';
import type { NfseParty, NfsePreview } from './nfse.types.js';

const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const date = (value: string) => value.split('-').reverse().join('/');
const shown = (value: string | null | undefined) => value || '—';

export function nfsePreviewPdf(preview: NfsePreview): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 28, info: { Title: `Prévia NFS-e — pedido ${preview.orderCode}`, Author: 'GestãoNF' } });
    const chunks: Buffer[] = [];
    pdf.on('data', chunk => chunks.push(Buffer.from(chunk)));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    const width = pdf.page.width - 56;
    const left = 28;
    const ensure = (height: number) => { if (pdf.y + height > pdf.page.height - 42) pdf.addPage(); };
    const section = (title: string) => {
      ensure(25);
      const y = pdf.y;
      pdf.fillColor('#eeeeee').rect(left, y, width, 18).fill();
      pdf.strokeColor('#6d767c').lineWidth(.5).rect(left, y, width, 18).stroke();
      pdf.fillColor('#252d32').font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), left + 6, y + 5, { width: width - 12 });
      pdf.y = y + 18;
    };
    const fields = (values: Array<[string, string | null | undefined]>, columns = 3) => {
      const columnWidth = width / columns;
      const height = 37;
      for (let offset = 0; offset < values.length; offset += columns) {
        ensure(height);
        const y = pdf.y;
        for (let col = 0; col < columns; col++) {
          const entry = values[offset + col];
          const x = left + col * columnWidth;
          pdf.strokeColor('#c1c8cc').lineWidth(.5).rect(x, y, columnWidth, height).stroke();
          if (!entry) continue;
          pdf.fillColor('#515e65').font('Helvetica-Bold').fontSize(6.6).text(entry[0].toUpperCase(), x + 5, y + 5, { width: columnWidth - 10, height: 12, ellipsis: true });
          pdf.fillColor('#252d32').font('Helvetica').fontSize(8).text(shown(entry[1]), x + 5, y + 17, { width: columnWidth - 10, height: 16, ellipsis: true });
        }
        pdf.y = y + height;
      }
    };
    const party = (title: string, value: NfseParty, extra?: string | null) => {
      section(title);
      fields([
        ['Nome / nome empresarial', value.name], ['CPF / CNPJ', value.taxId], ['Inscrição municipal', value.municipalRegistration],
        ['Endereço', [value.street, value.number, value.district].filter(Boolean).join(', ')],
        ['Município / UF', [value.cityName, value.stateCode].filter(Boolean).join(' / ')],
        ['Código IBGE / CEP', [value.cityIbgeCode, value.postalCode].filter(Boolean).join(' / ')],
        ['E-mail', value.email], ['Simples Nacional', extra],
      ]);
    };
    const note = (text: string, minimum = 25) => {
      const height = Math.max(minimum, pdf.heightOfString(text, { width: width - 12 }) + 14);
      ensure(height);
      const y = pdf.y;
      pdf.strokeColor('#c1c8cc').lineWidth(.5).rect(left, y, width, height).stroke();
      pdf.fillColor('#303b42').font('Helvetica').fontSize(8).text(text, left + 6, y + 7, { width: width - 12, height: height - 10 });
      pdf.y = y + height;
    };

    for (const [index, group] of preview.groups.entries()) {
      if (index) pdf.addPage();
      const environment = preview.environment === 'HOMOLOGATION' ? 'Homologação' : preview.environment === 'PRODUCTION' ? 'Produção' : 'Não configurado';
      pdf.fillColor('#9e3024').font('Helvetica-Bold').fontSize(9).text('PRÉ-VISUALIZAÇÃO — DOCUMENTO NÃO EMITIDO', left, pdf.y);
      pdf.font('Helvetica').fontSize(7).text('Sem validade fiscal ou jurídica. Sem chave de acesso e QR Code.', left, pdf.y + 4);
      pdf.moveDown(.7);
      const headerY = pdf.y;
      pdf.fillColor('#eeeeee').rect(left, headerY, width, 54).fill();
      pdf.strokeColor('#6d767c').lineWidth(.5).rect(left, headerY, width, 54).stroke();
      pdf.fillColor('#398053').font('Helvetica-Bold').fontSize(19).text('NFS-e', left + 8, headerY + 15);
      pdf.fillColor('#252d32').fontSize(10).text('DANFSe v2.0', left + 165, headerY + 12);
      pdf.fontSize(8).text('Documento Auxiliar da NFS-e · modelo de prévia', left + 165, headerY + 29);
      pdf.font('Helvetica').fontSize(7).text(`Município: ${shown(preview.issuer.cityName)}`, left + width - 155, headerY + 12, { width: 147, align: 'right' });
      pdf.text(`Ambiente da série: ${environment}`, left + width - 155, headerY + 27, { width: 147, align: 'right' });
      pdf.y = headerY + 54;

      section('Identificação da NFS-e');
      fields([
        ['Chave de acesso da NFS-e', 'Atribuída após autorização'], ['Número da NFS-e', 'Não emitida'], ['Competência', date(group.competence)],
        ['Data/hora de emissão da NFS-e', null], ['Número da DPS', 'Não reservado'], ['Série da DPS', preview.series?.number.toString()],
        ['Emitente', 'Prestador'], ['Situação', 'Prévia, sem autorização'], ['Finalidade', 'Emissão normal prevista'],
      ]);
      party('Prestador / fornecedor', preview.issuer, preview.simplesOption === '2' ? 'MEI / SIMEI' : preview.simplesOption === '3' ? 'ME/EPP no Simples Nacional' : null);
      party('Tomador / adquirente', preview.customer);
      section('Serviço prestado');
      fields([['Código de tributação nacional / municipal', [group.nationalTaxCode, group.municipalTaxCode].filter(Boolean).join(' / ')], ['Código NBS', group.nbsCode], ['Local da prestação · IBGE', group.municipalityIbgeCode]]);
      note(`Descrição do serviço\n${group.description || '—'}`, 70);
      section('Tributação municipal (ISSQN)');
      fields([['Tributação prevista', 'Operação sujeita ao ISSQN'], ['Retenção do ISSQN', group.issWithholding ? 'Revisão necessária' : 'Não retido'], ['ISSQN apurado', 'Apurado na autorização']]);
      section('Tributação federal e IBS/CBS');
      note('Campos calculados e autorizados pelo ambiente nacional serão apresentados no documento fiscal emitido.');
      section('Valor total da NFS-e · prévia');
      fields([['Valor da operação / serviço', money(group.grossAmount)], ['Desconto', money(group.discountAmount)], ['Valor previsto', money(group.totalAmount)]]);
      section('Informações complementares');
      note(`Pedido #${preview.orderCode}. ${preview.input.simplesTotalTaxPercent ? `Total aproximado de tributos informado: ${preview.input.simplesTotalTaxPercent}%.` : 'Total aproximado de tributos ainda não informado.'} Os valores fiscais definitivos dependem da autorização.`);
      ensure(30);
      pdf.fillColor('#68777f').font('Helvetica').fontSize(7).text(`Prévia ${index + 1} de ${preview.groups.length} · Gerada em ${new Date(preview.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Nenhuma NFS-e foi emitida`, left, pdf.y + 9, { width });
    }
    pdf.end();
  });
}
