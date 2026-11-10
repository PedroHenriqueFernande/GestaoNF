import { z } from 'zod';
import { createServiceSchema } from '../../services/services.schemas.js';
import type { SupportActionsService } from '../support-actions.service.js';
import { issues, type ToolSpec } from './tool-types.js';

const text = z.string().nullable();
const argsSchema = z.strictObject({ name: z.string(), internalCode: text, description: text, unitLabel: text, suggestedUnitPrice: text, nationalTaxCode: text });
const nullableString = { type: ['string', 'null'] };

export function serviceDraftTool(actions: SupportActionsService): ToolSpec<z.output<typeof argsSchema>> {
  return {
    definition: {
      type: 'function', name: 'preparar_cadastro_servico', strict: true,
      description: 'Prepara o cadastro de um serviço para o usuário conferir e confirmar. Não grava nada. Obrigatório: name. Use null para campos não informados. Preço com ponto decimal (ex.: 150.00). Código de tributação nacional com 6 dígitos, só se o usuário informar.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, internalCode: nullableString, description: nullableString, unitLabel: nullableString, suggestedUnitPrice: nullableString, nationalTaxCode: nullableString },
        required: ['name', 'internalCode', 'description', 'unitLabel', 'suggestedUnitPrice', 'nationalTaxCode'], additionalProperties: false,
      },
    },
    schema: argsSchema,
    async run(ctx, args) {
      const payload = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== ''));
      const parsed = createServiceSchema.safeParse(payload);
      if (!parsed.success) return { output: { ok: false, erro: 'Dados inválidos para o cadastro.', detalhes: issues(parsed.error) }, blocks: [] };
      const block = await actions.prepare(ctx, 'CREATE_SERVICE', parsed.data as Record<string, unknown>);
      return { output: { ok: true, situacao: 'AGUARDANDO_CONFIRMACAO', instrucao: 'Peça ao usuário para conferir e clicar em Confirmar no cartão. Nada foi gravado ainda.' }, blocks: [block] };
    },
  };
}
