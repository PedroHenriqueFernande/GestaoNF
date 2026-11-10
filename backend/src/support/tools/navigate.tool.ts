import { z } from 'zod';
import { destinationIds, destinationLabels, navigateBlock, type Destination } from '../support-blocks.js';
import type { ToolSpec } from './tool-types.js';

export function navigateTool(): ToolSpec<{ destino: Destination }> {
  return {
    definition: {
      type: 'function', name: 'abrir_tela', strict: true,
      description: `Mostra um botão para o usuário abrir uma tela do sistema. Destinos: ${destinationIds.map((id) => `${id} (${destinationLabels[id]})`).join(', ')}.`,
      parameters: { type: 'object', properties: { destino: { type: 'string', enum: destinationIds } }, required: ['destino'], additionalProperties: false },
    },
    schema: z.strictObject({ destino: z.enum(destinationIds) }),
    async run(_ctx, { destino }) {
      return { output: { ok: true, botao: destinationLabels[destino] }, blocks: [navigateBlock(destino)] };
    },
  };
}
