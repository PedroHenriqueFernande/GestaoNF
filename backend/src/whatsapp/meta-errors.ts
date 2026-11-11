// backend/src/whatsapp/meta-errors.ts
export type MetaSendError = Error & { providerCode?: number; httpStatus?: number };

/** Códigos que não mudam com nova tentativa: conta, nome de exibição, pagamento, qualidade, destinatário, template, janela, parâmetro. */
const NON_RETRYABLE = new Set([100, 131026, 131037, 131042, 131047, 131048, 132001, 190]);

export function isRetryableMetaError(error: MetaSendError) {
  if (error.providerCode !== undefined && NON_RETRYABLE.has(Number(error.providerCode))) return false;
  if (error.providerCode === undefined && error.httpStatus !== undefined && error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 429) return false;
  return true;
}

export function describeMetaError(error: MetaSendError) {
  return error.providerCode !== undefined ? `Meta #${error.providerCode}: ${error.message}` : error.message;
}
