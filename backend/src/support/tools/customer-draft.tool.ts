import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { customers } from '@gestaonf/database/schema';
import type { DatabaseService } from '../../database/database.module.js';
import { createCustomerSchema } from '../../customers/customers.schemas.js';
import { customerKindFromTaxId } from '../../customers/tax-id.js';
import type { SupportActionsService } from '../support-actions.service.js';
import { issues, type ToolSpec } from './tool-types.js';

const text = z.string().nullable();
const argsSchema = z.strictObject({
  name: z.string(), tradeName: text, taxId: text, email: text, phone: text, cityName: text, stateCode: text, notes: text,
});
const nullableString = { type: ['string', 'null'] };

export function customerDraftTool(actions: SupportActionsService, database: DatabaseService): ToolSpec<z.output<typeof argsSchema>> {
  return {
    permission: 'customers.create',
    definition: {
      type: 'function', name: 'preparar_cadastro_cliente', strict: true,
      description: 'Prepara o cadastro de um cliente para o usuário conferir e confirmar. Não grava nada. Apenas o nome é obrigatório. CPF/CNPJ identifica automaticamente PF ou PJ. Use null para campos não informados.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' }, tradeName: nullableString,
          taxId: { type: ['string', 'null'], description: 'CPF ou CNPJ, só dígitos' }, email: nullableString, phone: nullableString,
          cityName: nullableString, stateCode: { type: ['string', 'null'], description: 'UF com 2 letras' }, notes: nullableString,
        },
        required: ['name', 'tradeName', 'taxId', 'email', 'phone', 'cityName', 'stateCode', 'notes'], additionalProperties: false,
      },
    },
    schema: argsSchema,
    async run(ctx, args) {
      const payload = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== ''));
      const parsed = createCustomerSchema.safeParse(payload);
      if (!parsed.success) return { output: { ok: false, erro: 'Dados inválidos para o cadastro.', detalhes: issues(parsed.error) }, blocks: [] };
      const kind = parsed.data.taxId ? customerKindFromTaxId(parsed.data.taxId) : null;
      if (kind !== 'PJ' && parsed.data.tradeName) return { output: { ok: false, erro: 'Nome fantasia exige CNPJ válido.' }, blocks: [] };
      if (parsed.data.taxId) {
        const [duplicate] = await database.db.select({ id: customers.id }).from(customers)
          .where(and(eq(customers.companyId, ctx.companyId), eq(customers.taxId, parsed.data.taxId))).limit(1);
        if (duplicate) return { output: { ok: false, erro: 'Já existe cliente com este CPF/CNPJ nesta empresa.' }, blocks: [] };
      }
      const block = await actions.prepare(ctx, 'CREATE_CUSTOMER', parsed.data as Record<string, unknown>);
      return { output: { ok: true, situacao: 'AGUARDANDO_CONFIRMACAO', instrucao: 'Peça ao usuário para conferir e clicar em Confirmar no cartão. Nada foi gravado ainda.' }, blocks: [block] };
    },
  };
}
