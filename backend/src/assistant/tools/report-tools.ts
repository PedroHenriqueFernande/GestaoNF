// backend/src/assistant/tools/report-tools.ts
import { z } from 'zod';
import type { ReportsReadService } from '../../reports/reports-read.service.js';
import type { ReportType } from '../../reports/reports.schemas.js';
import { money } from '../nero-format.js';
import { rules } from '../nero-policy.js';
import { compactList, label, optionalSearch, parseToolArgs, PERIOD_VALUES, periodProperties, resolvePeriod } from './read-support.js';
import type { ReadTool } from './types.js';

type SummaryKind = 'number' | 'money' | 'percent';
type Definition = {
  type: ReportType; label: string; catalog: boolean;
  /** Campos do resumo do relatório: chave original -> [rótulo em português, tipo do valor]. */
  summary: Record<string, [string, SummaryKind]>;
  /** Campos permitidos de cada linha: chave original -> nome entregue ao modelo (sem IDs, endereço completo nem códigos fiscais). */
  fields: Record<string, string>;
  /** Campos cujo valor é um código interno a traduzir (status, formas de pagamento etc.). */
  translate?: string[];
};

const TYPES: Record<string, Definition> = {
  servicos_fechados: {
    type: 'closed-services', label: 'Serviços fechados', catalog: false,
    summary: { saleCount: ['vendas', 'number'], contractedAmount: ['contratado', 'money'], receivedAmount: ['recebido', 'money'], pendingAmount: ['a receber', 'money'] },
    fields: { soldOn: 'data', orderCode: 'pedido', workOrderNumber: 'os', customerName: 'cliente', userName: 'lancadoPor', contractedAmount: 'valorContratado', receivedAmount: 'recebido', pendingAmount: 'aReceber', items: 'servicos' },
  },
  recebimentos: {
    type: 'service-receipts', label: 'Recebimentos', catalog: false,
    summary: { movementCount: ['movimentos', 'number'], grossAmount: ['recebido', 'money'], reversedAmount: ['estornado', 'money'], netAmount: ['líquido', 'money'] },
    fields: { effectiveOn: 'data', kind: 'tipo', amount: 'valor', paymentMethod: 'forma', orderCode: 'pedido', customerName: 'cliente', userName: 'registradoPor' },
    translate: ['kind', 'paymentMethod'],
  },
  entradas_de_leads: {
    type: 'lead-entries', label: 'Entradas de leads', catalog: false,
    summary: { entries: ['entradas', 'number'], uniqueLeads: ['leads únicos', 'number'] },
    fields: { receivedAt: 'recebidoEm', contactName: 'contato', email: 'email', title: 'oportunidade', commercialStatus: 'situacao', userName: 'responsavel', captureKind: 'canal', sourceLabel: 'origem', utmSource: 'utmSource', utmCampaign: 'utmCampaign', serviceName: 'servico', interestDescription: 'interesse' },
    translate: ['commercialStatus', 'captureKind'],
  },
  clientes: {
    type: 'customers', label: 'Clientes', catalog: true,
    summary: { total: ['total', 'number'], active: ['ativos', 'number'], inactive: ['inativos', 'number'] },
    fields: { createdAt: 'cadastradoEm', name: 'nome', kind: 'tipo', status: 'situacao', tradeName: 'nomeFantasia', taxId: 'documento', email: 'email', phone: 'telefone', cityName: 'cidade', stateCode: 'uf' },
    translate: ['kind', 'status'],
  },
  catalogo_de_servicos: {
    type: 'service-catalog', label: 'Catálogo de serviços', catalog: true,
    summary: { total: ['total', 'number'], active: ['ativos', 'number'], inactive: ['inativos', 'number'] },
    fields: { createdAt: 'cadastradoEm', name: 'nome', status: 'situacao', internalCode: 'codigo', description: 'descricao', unitLabel: 'unidade', suggestedUnitPrice: 'precoPadrao' },
    translate: ['status'],
  },
  reunioes: {
    type: 'meetings', label: 'Reuniões', catalog: false,
    summary: { total: ['total', 'number'], completed: ['realizadas', 'number'], canceled: ['canceladas', 'number'], noShow: ['não compareceu', 'number'], scheduled: ['agendadas', 'number'] },
    fields: { startsAt: 'inicio', endsAt: 'fim', title: 'titulo', status: 'situacao', modality: 'modalidade', contactName: 'contato', userName: 'responsavel' },
    translate: ['status', 'modality'],
  },
  taxa_de_desqualificacao: {
    type: 'disqualification-rate', label: 'Taxa de desqualificação', catalog: false,
    summary: { decisions: ['decisões', 'number'], won: ['ganhos', 'number'], lost: ['perdidos', 'number'], disqualified: ['desqualificados', 'number'], rate: ['taxa', 'percent'] },
    fields: { decidedAt: 'decididoEm', contactName: 'contato', title: 'oportunidade', decisionStatus: 'decisao', userName: 'responsavel', serviceName: 'servico', captureKind: 'canal', utmSource: 'utmSource', utmCampaign: 'utmCampaign', reason: 'motivo' },
    translate: ['decisionStatus', 'captureKind'],
  },
  taxa_de_perda: {
    type: 'loss-rate', label: 'Taxa de perda', catalog: false,
    summary: { decisions: ['decisões', 'number'], won: ['ganhos', 'number'], lost: ['perdidos', 'number'], disqualified: ['desqualificados', 'number'], rate: ['taxa', 'percent'] },
    fields: { decidedAt: 'decididoEm', contactName: 'contato', title: 'oportunidade', decisionStatus: 'decisao', userName: 'responsavel', serviceName: 'servico', captureKind: 'canal', utmSource: 'utmSource', utmCampaign: 'utmCampaign', reason: 'motivo' },
    translate: ['decisionStatus', 'captureKind'],
  },
};
const NAMES = Object.keys(TYPES) as [string, ...string[]];
const schema = z.object({ tipo: z.enum(NAMES), periodo: z.enum(PERIOD_VALUES), inicio: z.string().nullable(), fim: z.string().nullable(), busca: optionalSearch(200) }).strict();

/** Só os campos permitidos da linha, com os nomes em português e os códigos internos traduzidos. */
function project(definition: Definition, row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [source, name] of Object.entries(definition.fields)) {
    const value = row[source];
    if (value === null || value === undefined) continue;
    if (source === 'items' && Array.isArray(value)) {
      out[name] = value.map((item) => ({ nome: (item as Record<string, unknown>).name, quantidade: (item as Record<string, unknown>).quantity, total: (item as Record<string, unknown>).totalAmount }));
    } else out[name] = definition.translate?.includes(source) ? label(value) : value;
  }
  return out;
}

function translateSummary(definition: Definition, summary: Record<string, unknown>) {
  const out: Record<string, { valor: unknown; tipo: SummaryKind }> = {};
  for (const [key, [name, kind]] of Object.entries(definition.summary)) {
    if (summary[key] !== null && summary[key] !== undefined) out[name] = { valor: summary[key], tipo: kind };
  }
  return out;
}

const formatValue = (value: unknown, kind: SummaryKind) => (kind === 'money' ? money(String(value)) : kind === 'percent' ? `${String(value).replace('.', ',')}%` : String(value));

export function createReportTool(reports: ReportsReadService): ReadTool {
  return {
    kind: 'READ', name: 'relatorio', allowed: rules.anyMember,
    description: 'Lê um dos relatórios do GestãoNF: servicos_fechados, recebimentos, entradas_de_leads, clientes, catalogo_de_servicos, reunioes, taxa_de_desqualificacao, taxa_de_perda. Os dois catálogos aceitam SEM_PERIODO; os demais exigem período. Respeita o que o usuário pode ver no CRM.',
    parameters: {
      type: 'object',
      properties: { tipo: { type: 'string', enum: NAMES }, ...periodProperties, busca: { type: ['string', 'null'] } },
      required: ['tipo', 'periodo', 'inicio', 'fim', 'busca'], additionalProperties: false,
    },
    async run(ctx, raw) {
      const args = parseToolArgs(schema, raw);
      const definition = TYPES[args.tipo];
      const range = resolvePeriod(args, ctx.today, { allowNone: definition.catalog });
      const result = await reports.read({ companyId: ctx.companyId, userId: ctx.userId }, definition.type, {
        limit: 10, status: 'ALL', ...(range ? { from: range.from, to: range.to } : {}), ...(args.busca ? { search: args.busca } : {}),
      });
      const assigned = result.visibility === 'ASSIGNED';
      const summary = translateSummary(definition, result.summary as Record<string, unknown>);
      const pairs = Object.entries(summary).map(([name, { valor, tipo }]) => `${name} ${formatValue(valor, tipo)}`).join(', ').slice(0, 200);
      return {
        output: {
          relatorio: definition.label, periodo: range ?? 'sem filtro de data', visibilidade: assigned ? 'somente o que é seu' : 'empresa',
          resumo: Object.fromEntries(Object.entries(summary).map(([name, { valor }]) => [name, valor])),
          items: compactList((result.items as Record<string, unknown>[]).map((row) => project(definition, row))).items, haMais: Boolean(result.nextCursor),
        },
        memory: `Relatório ${definition.label}${range ? ` de ${range.from} a ${range.to}` : ''}${args.busca ? ` (busca "${args.busca}")` : ''}${assigned ? ' (somente o que é seu)' : ''}: ${pairs}`,
      };
    },
  };
}
