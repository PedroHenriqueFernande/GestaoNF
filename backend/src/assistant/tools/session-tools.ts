// backend/src/assistant/tools/session-tools.ts
import type { ReadTool } from './types.js';

export const switchCompanyTool: ReadTool = {
  kind: 'READ',
  name: 'trocar_empresa',
  description: 'Use quando o usuário quiser falar de outra empresa vinculada. Informe o nome citado, ou null se ele não disse qual.',
  parameters: { type: 'object', properties: { empresa: { type: ['string', 'null'] } }, required: ['empresa'], additionalProperties: false },
  permission: 'ANY_MEMBER',
  available: (ctx) => ctx.companyCount > 1,
  async run(_ctx, raw) {
    const name = (raw as { empresa?: unknown } | null)?.empresa;
    const companyName = typeof name === 'string' && name.trim() ? name.trim() : null;
    return { output: { ok: true }, memory: `Usuário pediu para trocar de empresa${companyName ? ` para ${companyName}` : ''}.`, control: { kind: 'SWITCH_COMPANY', companyName } };
  },
};

export const newTopicTool: ReadTool = {
  kind: 'READ',
  name: 'encerrar_assunto',
  description: 'Use quando o usuário disser que quer começar um assunto novo. O histórico desta conversa é encerrado após sua resposta.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  permission: 'ANY_MEMBER',
  async run() {
    return { output: { ok: true }, memory: 'Usuário encerrou o assunto.', control: { kind: 'NEW_TOPIC' } };
  },
};
