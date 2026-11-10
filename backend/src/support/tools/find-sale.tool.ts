import { z } from 'zod';
import type { SalesService } from '../../sales/sales.service.js';
import { listSalesSchema } from '../../sales/sales.schemas.js';
import { saleBlock } from '../support-blocks.js';
import type { ToolSpec } from './tool-types.js';

export function findSaleTool(sales: SalesService): ToolSpec<{ busca: string }> {
  return {
    definition: {
      type: 'function', name: 'localizar_venda_para_emissao', strict: true,
      description: 'Procura pedidos confirmados pelo código do pedido ou nome do cliente e mostra botões para abrir o pedido, onde fica a emissão da NFS-e. Não emite a nota.',
      parameters: { type: 'object', properties: { busca: { type: 'string', description: 'Código do pedido (sem #) ou nome do cliente' } }, required: ['busca'], additionalProperties: false },
    },
    schema: z.strictObject({ busca: z.string().trim().min(1).max(100) }),
    async run(ctx, { busca }) {
      const search = busca.replace(/^#\s*/, '').trim();
      if (!search) return { output: { ok: true, vendas: [], instrucao: 'Busca vazia. Peça o código do pedido ou o nome do cliente.' }, blocks: [] };
      const result = await sales.list(ctx.companyId, listSalesSchema.parse({ status: 'CONFIRMED', search, limit: 5 }));
      const found = result.items.map((sale) => ({ id: sale.id, codigo: sale.orderCode, cliente: sale.customerNameSnapshot, data: sale.soldOn, total: sale.totalAmount }));
      return {
        output: {
          ok: true,
          vendas: found.map(({ id: _id, ...sale }) => sale),
          instrucao: found.length
            ? 'Ofereça abrir o pedido. A emissão é feita pelo botão Emitir NFS-e na tela do pedido.'
            : 'Nenhum pedido confirmado encontrado. Peça o código do pedido ou o nome do cliente.',
        },
        blocks: found.map((sale) => saleBlock({ id: sale.id, orderCode: sale.codigo, customerName: sale.cliente }, ctx.companyId)),
      };
    },
  };
}
