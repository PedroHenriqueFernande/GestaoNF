// backend/src/assistant/nero-format.ts
/** Negrito do WhatsApp; remove asteriscos internos para não quebrar a marcação. */
export const bold = (text: string) => `*${text.replace(/\*/g, '')}*`;

export const money = (value: number | string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));

export const brDate = (isoDate: string) => isoDate.split('-').reverse().join('/');

/** Nome da empresa no topo apenas para quem tem várias empresas vinculadas. */
export function withCompanyHeader(text: string, companyName: string, companyCount: number) {
  return companyCount > 1 ? `${bold(companyName)}\n${text}` : text;
}

/** ID do botão clicado, a partir do payload da mensagem recebida da Meta. */
export function buttonReplyId(payload: unknown): string | null {
  const interactive = (payload as { interactive?: { button_reply?: { id?: unknown } } } | null)?.interactive;
  const id = interactive?.button_reply?.id;
  return typeof id === 'string' && id ? id : null;
}
