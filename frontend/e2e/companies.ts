import { ALL_PERMISSIONS, closure, type PermissionKey, type RoleLabel } from '@gestaonf/permissions';

/** Formato de `GET /companies` (Spec 8.1) para os mocks dos e2e. */
export type MockCompany = { id: string; name: string; accountId: string; logoId: string | null; roleLabel: RoleLabel; accountOwner: boolean; permissions: PermissionKey[] };

export const ownerCompany = (id: string, name: string, accountId: string): MockCompany =>
  ({ id, name, accountId, logoId: null, roleLabel: 'OWNER', accountOwner: true, permissions: [...ALL_PERMISSIONS] });
export const memberCompany = (id: string, name: string, accountId: string, keys: PermissionKey[], roleLabel: RoleLabel = 'COLLABORATOR'): MockCompany =>
  ({ id, name, accountId, logoId: null, roleLabel, accountOwner: false, permissions: [...closure(keys)] });
