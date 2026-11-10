import { z } from 'zod';
import type { SupportHelpCatalog } from '../help-catalog.js';
import type { ToolSpec } from './tool-types.js';

export function helpTool(catalog: SupportHelpCatalog): ToolSpec<{ topico: string }> {
  const ids = catalog.ids();
  return {
    definition: {
      type: 'function', name: 'buscar_ajuda', strict: true,
      description: 'Lê o artigo de ajuda do GestãoNF sobre um tópico. Use antes de explicar qualquer funcionalidade.',
      parameters: { type: 'object', properties: { topico: { type: 'string', enum: ids } }, required: ['topico'], additionalProperties: false },
    },
    schema: z.strictObject({ topico: z.enum(ids) }),
    async run(_ctx, { topico }) {
      const article = catalog.get(topico)!;
      return { output: { ok: true, titulo: article.titulo, rota: article.rota, conteudo: article.conteudo }, blocks: [] };
    },
  };
}
