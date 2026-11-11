// backend/src/assistant/actions/action-summary.ts
import type { OutboundButton } from '../../whatsapp/meta-cloud.client.js';
import { bold } from '../nero-format.js';

export const ACTION_BUTTON_PREFIX = 'nero:';
const VERBS = ['confirm', 'correct', 'cancel'] as const;
export type ActionVerb = typeof VERBS[number];

/** Resumo determinístico: é exatamente o que será gravado. Nunca gerado pela IA. */
export function buildSummary(companyName: string, lines: string[], ttlMinutes: number) {
  return [`Posso gravar na ${bold(companyName)}?`, '', ...lines.map((line, index) => `${index + 1}. ${line}`), '', `Toque em *Confirmar* para gravar. Vale por ${ttlMinutes} minutos.`].join('\n');
}

export function actionButtons(actionId: string): OutboundButton[] {
  return [
    { id: `${ACTION_BUTTON_PREFIX}confirm:${actionId}`, title: 'Confirmar' },
    { id: `${ACTION_BUTTON_PREFIX}correct:${actionId}`, title: 'Corrigir' },
    { id: `${ACTION_BUTTON_PREFIX}cancel:${actionId}`, title: 'Cancelar' },
  ];
}

export function parseActionButton(id: string | null): { verb: ActionVerb; actionId: string } | null {
  const match = id?.match(/^nero:(confirm|correct|cancel):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match ? { verb: match[1] as ActionVerb, actionId: match[2] } : null;
}
