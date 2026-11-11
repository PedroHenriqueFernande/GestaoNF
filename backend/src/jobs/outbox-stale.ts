// backend/src/jobs/outbox-stale.ts
export const MAX_PUBLICATIONS = 10;
export type StaleDecision = 'REPUBLISH' | 'WAIT' | 'COMPLETE' | 'FAIL';

/** Decide o que fazer com um registro PUBLISHED sem conclusão, a partir do estado do job no BullMQ. */
export function staleDecision(jobState: string, attempts: number): StaleDecision {
  if (jobState === 'failed') return 'FAIL';
  if (jobState === 'completed') return 'COMPLETE';
  if (jobState === 'unknown') return attempts >= MAX_PUBLICATIONS ? 'FAIL' : 'REPUBLISH';
  return 'WAIT';
}
