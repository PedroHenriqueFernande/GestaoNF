// backend/src/assistant/tools/catalog-tools.ts
import { z } from 'zod';
import type { CustomersService } from '../../customers/customers.service.js';
import type { ServicesService } from '../../services/services.service.js';
import { rules } from '../nero-policy.js';
import { compactList, label, optionalSearch, parseToolArgs } from './read-support.js';
import type { ReadTool } from './types.js';

const STATUS = { ATIVOS: 'ACTIVE', INATIVOS: 'INACTIVE', TODOS: 'ALL' } as const;
const argsSchema = z.object({ busca: optionalSearch(100), situacao: z.enum(['ATIVOS', 'INATIVOS', 'TODOS']) }).strict();
const parametersFor = (searchDescription: string) => ({
  type: 'object',
  properties: {
    busca: { type: ['string', 'null'], description: searchDescription },
    situacao: { type: 'string', enum: ['ATIVOS', 'INATIVOS', 'TODOS'] },
  },
  required: ['busca', 'situacao'], additionalProperties: false,
});
const listed = (rows: unknown[], total: number) => { const { items } = compactList(rows); return { items, omitted: Math.max(0, total - items.length) }; };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function createCustomerSearchTool(customers: CustomersService): ReadTool {
  return {
    kind: 'READ', name: 'buscar_clientes', parameters: parametersFor('Parte do nome, nome fantasia, CPF/CNPJ ou telefone; null lista os primeiros.'), allowed: rules.anyMember,
    description: 'Busca clientes cadastrados na empresa atual. Use antes de qualquer pedido que dependa de um cliente; se houver mais de um parecido, pergunte qual.',
    async run(ctx, raw) {
      const args = parseToolArgs(argsSchema, raw);
      const result = await customers.list(ctx.companyId, { limit: 10, offset: 0, status: STATUS[args.situacao], search: args.busca ?? undefined });
      const rows = result.items.map((item) => ({ id: item.id, tipo: label(item.kind), nome: item.name, nomeFantasia: item.tradeName, documento: item.taxId, telefone: item.phone, email: item.email, cidade: item.cityName, uf: item.stateCode, situacao: label(item.status) }));
      return {
        output: { total: result.total, ...listed(rows, result.total) },
        memory: `Busca de clientes${args.busca ? ` "${args.busca}"` : ''}: ${plural(result.total, 'encontrado', 'encontrados')}${rows.length ? ` (${rows.slice(0, 3).map((row) => row.nome).join(', ')})` : ''}.`,
      };
    },
  };
}

export function createServiceSearchTool(services: ServicesService): ReadTool {
  return {
    kind: 'READ', name: 'buscar_servicos', parameters: parametersFor('Parte do nome ou do código; null lista os primeiros.'), allowed: rules.anyMember,
    description: 'Busca serviços do catálogo da empresa atual (nome ou código). Use antes de qualquer pedido que dependa de um serviço.',
    async run(ctx, raw) {
      const args = parseToolArgs(argsSchema, raw);
      const result = await services.list(ctx.companyId, { limit: 10, offset: 0, status: STATUS[args.situacao], search: args.busca ?? undefined });
      // Colunas reais: internalCode, unitLabel e suggestedUnitPrice (o "preço padrão" do plano).
      const rows = result.items.map((item) => ({ id: item.id, nome: item.name, codigo: item.internalCode, unidade: item.unitLabel, precoPadrao: item.suggestedUnitPrice, situacao: label(item.status) }));
      return {
        output: { total: result.total, ...listed(rows, result.total) },
        memory: `Busca de serviços${args.busca ? ` "${args.busca}"` : ''}: ${plural(result.total, 'encontrado', 'encontrados')}${rows.length ? ` (${rows.slice(0, 3).map((row) => row.nome).join(', ')})` : ''}.`,
      };
    },
  };
}
