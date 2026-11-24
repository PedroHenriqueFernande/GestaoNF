import type { PermissionView } from '../permissions/usePermissions';

/** Proposta a partir de cliente cria a negociação: o servidor exige `crm.create` além de `proposals.manage` (proposals.service.ts:117). */
export const canProposeFromCustomer = (access: Pick<PermissionView, 'can'>) => access.can('proposals.manage') && access.can('crm.create');
