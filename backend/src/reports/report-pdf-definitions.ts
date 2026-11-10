import type { ReportType } from './reports.schemas.js';
import type { PdfColumn, PdfFormat } from './reports-pdf.js';

export type PdfSummaryItem = { key: string; label: string; format: PdfFormat; empty?: string };
type Definition = { title: string; columns: PdfColumn[]; summary: PdfSummaryItem[] };

export function reportFilename(type: ReportType, from: string | null | undefined, to: string | null | undefined) {
  return `${type}${from && to ? `-${from}-a-${to}` : ''}.pdf`;
}

export const reportPdfDefinitions: Record<ReportType, Definition> = {
  'closed-services': {
    title: 'Serviços fechados',
    columns: [
      { key: 'orderCode', label: 'Pedido', weight: 1 }, { key: 'customerName', label: 'Cliente', weight: 2.5 },
      { key: 'items', label: 'Serviços', weight: 3, format: 'items' }, { key: 'soldOn', label: 'Data da venda', weight: 1.2, format: 'date' },
      { key: 'userName', label: 'Lançado por', weight: 1.6 }, { key: 'contractedAmount', label: 'Valor contratado', weight: 1.4, format: 'money' },
    ],
    summary: [
      { key: 'contractedAmount', label: 'Total contratado', format: 'money' },
      { key: 'saleCount', label: 'Pedidos confirmados', format: 'number' },
      { key: 'receivedAmount', label: 'Recebido dessas vendas', format: 'money' },
      { key: 'pendingAmount', label: 'Pendente dessas vendas', format: 'money' },
    ],
  },
  'service-receipts': {
    title: 'Recebimento de serviços',
    columns: [
      { key: 'effectiveOn', label: 'Data', weight: 1.1, format: 'date' }, { key: 'orderCode', label: 'Pedido', weight: 1 },
      { key: 'customerName', label: 'Cliente', weight: 2.4 }, { key: 'paycode', label: 'Parcela', weight: 1 },
      { key: 'kind', label: 'Movimento', weight: 1.2, format: 'status' }, { key: 'paymentMethod', label: 'Forma', weight: 1.4, format: 'status' },
      { key: 'userName', label: 'Lançado por', weight: 1.6 }, { key: 'signedAmount', label: 'Valor', weight: 1.3, format: 'money' },
    ],
    summary: [
      { key: 'netAmount', label: 'Recebido líquido', format: 'money' },
      { key: 'grossAmount', label: 'Recebimentos', format: 'money' },
      { key: 'reversedAmount', label: 'Estornos', format: 'money' },
      { key: 'movementCount', label: 'Movimentos', format: 'number' },
    ],
  },
  'lead-entries': {
    title: 'Entrada de leads',
    columns: [
      { key: 'receivedAt', label: 'Entrada', weight: 1.4, format: 'instant' }, { key: 'contactName', label: 'Lead', weight: 2 },
      { key: 'title', label: 'Negociação', weight: 2 }, { key: 'captureKind', label: 'Canal', weight: 1.2, format: 'status' },
      { key: 'utmSource', label: 'Origem', weight: 1.2 }, { key: 'utmCampaign', label: 'Campanha', weight: 1.4 },
      { key: 'serviceName', label: 'Serviço de interesse', weight: 1.8 }, { key: 'userName', label: 'Responsável', weight: 1.5 },
    ],
    summary: [
      { key: 'entries', label: 'Entradas no CRM', format: 'number' },
      { key: 'uniqueLeads', label: 'Leads únicos', format: 'number' },
    ],
  },
  customers: {
    title: 'Clientes',
    columns: [
      { key: 'name', label: 'Cliente', weight: 2.6 }, { key: 'kind', label: 'Tipo', weight: 1.3, format: 'status' },
      { key: 'taxId', label: 'CPF / CNPJ', weight: 1.5 }, { key: 'email', label: 'E-mail', weight: 2.2 },
      { key: 'phone', label: 'Telefone', weight: 1.3 }, { key: 'status', label: 'Situação', weight: 1, format: 'status' },
      { key: 'createdAt', label: 'Cadastro', weight: 1.4, format: 'instant' },
    ],
    summary: [
      { key: 'total', label: 'Total de cadastros', format: 'number' },
      { key: 'active', label: 'Ativos', format: 'number' },
      { key: 'inactive', label: 'Inativos', format: 'number' },
    ],
  },
  'service-catalog': {
    title: 'Catálogo de serviços',
    columns: [
      { key: 'internalCode', label: 'Código', weight: 1 }, { key: 'name', label: 'Serviço', weight: 3 },
      { key: 'unitLabel', label: 'Unidade', weight: 0.9 }, { key: 'suggestedUnitPrice', label: 'Preço sugerido', weight: 1.3, format: 'money' },
      { key: 'status', label: 'Situação', weight: 1, format: 'status' }, { key: 'createdAt', label: 'Cadastro', weight: 1.4, format: 'instant' },
    ],
    summary: [
      { key: 'total', label: 'Total de cadastros', format: 'number' },
      { key: 'active', label: 'Ativos', format: 'number' },
      { key: 'inactive', label: 'Inativos', format: 'number' },
    ],
  },
  meetings: {
    title: 'Reuniões',
    columns: [
      { key: 'startsAt', label: 'Início', weight: 1.4, format: 'instant' }, { key: 'title', label: 'Reunião', weight: 2.5 },
      { key: 'contactName', label: 'Lead', weight: 2 }, { key: 'userName', label: 'Responsável', weight: 1.6 },
      { key: 'modality', label: 'Modalidade', weight: 1.2, format: 'status' }, { key: 'status', label: 'Situação', weight: 1.3, format: 'status' },
    ],
    summary: [
      { key: 'completed', label: 'Reuniões realizadas', format: 'number' },
      { key: 'total', label: 'Total agendado', format: 'number' },
      { key: 'scheduled', label: 'A realizar', format: 'number' },
      { key: 'canceled', label: 'Canceladas', format: 'number' },
      { key: 'noShow', label: 'Não compareceu', format: 'number' },
    ],
  },
  'disqualification-rate': {
    title: 'Taxa de desqualificação',
    columns: [
      { key: 'decidedAt', label: 'Encerramento', weight: 1.4, format: 'instant' }, { key: 'contactName', label: 'Lead', weight: 2 },
      { key: 'title', label: 'Negociação', weight: 2 }, { key: 'reason', label: 'Motivo', weight: 2.2 },
      { key: 'userName', label: 'Responsável', weight: 1.5 }, { key: 'utmCampaign', label: 'Campanha', weight: 1.3 },
      { key: 'currentStatus', label: 'Situação atual', weight: 1.3, format: 'status' },
    ],
    summary: [
      { key: 'rate', label: 'Taxa no período', format: 'percent', empty: 'Sem base para cálculo' },
      { key: 'disqualified', label: 'Desqualificadas', format: 'number' },
      { key: 'decisions', label: 'Negociações encerradas', format: 'number' },
      { key: 'won', label: 'Ganhas', format: 'number' },
    ],
  },
  'loss-rate': {
    title: 'Taxa de perda',
    columns: [
      { key: 'decidedAt', label: 'Encerramento', weight: 1.4, format: 'instant' }, { key: 'contactName', label: 'Lead', weight: 2 },
      { key: 'title', label: 'Negociação', weight: 2 }, { key: 'reason', label: 'Motivo', weight: 2.2 },
      { key: 'userName', label: 'Responsável', weight: 1.5 }, { key: 'utmCampaign', label: 'Campanha', weight: 1.3 },
      { key: 'currentStatus', label: 'Situação atual', weight: 1.3, format: 'status' },
    ],
    summary: [
      { key: 'rate', label: 'Taxa no período', format: 'percent', empty: 'Sem base para cálculo' },
      { key: 'lost', label: 'Perdidas', format: 'number' },
      { key: 'decisions', label: 'Negociações encerradas', format: 'number' },
      { key: 'won', label: 'Ganhas', format: 'number' },
    ],
  },
};
