import { z } from 'zod';
import type { SupportToolDefinition } from '../llm/support-llm.client.js';
import { NOT_ALLOWED_GUIDANCE } from '../../permissions/actor.js';
import { allowedDestinations, canOpenDestination, destinationIds, destinationLabel, navigateBlock, type Destination } from '../support-blocks.js';
import type { ToolSpec } from './tool-types.js';

const definitionFor = (ids: readonly [Destination, ...Destination[]]): SupportToolDefinition => ({
  type: 'function', name: 'abrir_tela', strict: true,
  description: `Mostra um botão para o usuário abrir uma tela do sistema. Destinos: ${ids.map((id) => `${id} (${destinationLabel(id)})`).join(', ')}.`,
  parameters: { type: 'object', properties: { destino: { type: 'string', enum: ids } }, required: ['destino'], additionalProperties: false },
});

export function navigateTool(): ToolSpec<{ destino: Destination }> {
  return {
    permission: 'ANY_MEMBER',
    definition: definitionFor(destinationIds),
    forContext: (ctx) => definitionFor(allowedDestinations(ctx.actor)),
    schema: z.strictObject({ destino: z.enum(destinationIds) }),
    async run(ctx, { destino }) {
      if (!canOpenDestination(ctx.actor, destino)) return { output: { ok: false, erro: NOT_ALLOWED_GUIDANCE }, blocks: [] };
      return { output: { ok: true, botao: destinationLabel(destino) }, blocks: [navigateBlock(destino)] };
    },
  };
}
