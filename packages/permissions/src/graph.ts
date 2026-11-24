import { PERMISSIONS, PERMISSION_KEYS, isPermissionKey, type PermissionKey } from './catalog.js';

const REQUIRED_BY: ReadonlyMap<PermissionKey, readonly PermissionKey[]> = (() => {
  const map = new Map<PermissionKey, PermissionKey[]>();
  for (const key of PERMISSION_KEYS) {
    for (const requirement of PERMISSIONS[key].requires) {
      map.set(requirement, [...(map.get(requirement) ?? []), key]);
    }
  }
  return map;
})();

/** As chaves informadas mais todas as dependências, transitivamente. */
export function closure(keys: Iterable<PermissionKey>): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  const stack = [...keys];
  while (stack.length) {
    const key = stack.pop()!;
    if (result.has(key)) continue;
    result.add(key);
    stack.push(...PERMISSIONS[key].requires);
  }
  return result;
}

/** Chaves que dependem, transitivamente, de alguma das informadas (sem incluir as informadas). */
export function dependents(keys: Iterable<PermissionKey>): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  const given = new Set(keys);
  const stack = [...given];
  while (stack.length) {
    for (const dependent of REQUIRED_BY.get(stack.pop()!) ?? []) {
      if (given.has(dependent) || result.has(dependent)) continue;
      result.add(dependent);
      stack.push(dependent);
    }
  }
  return result;
}

export function sortByCatalog(keys: Iterable<PermissionKey>): PermissionKey[] {
  const set = new Set(keys);
  return PERMISSION_KEYS.filter(key => set.has(key));
}

export type DependencyGap = Readonly<{ permission: PermissionKey; requires: PermissionKey }>;
export type ValidationResult =
  | { ok: true; permissions: PermissionKey[] }
  | { ok: false; code: 'UNKNOWN_PERMISSION'; unknown: string[] }
  | { ok: false; code: 'PERMISSION_DEPENDENCY_MISSING'; missing: DependencyGap[] };

/** Função única de validação (Spec 5.1): o servidor valida, não completa. */
export function validate(input: readonly string[]): ValidationResult {
  const unknown = [...new Set(input.filter(value => !isPermissionKey(value)))];
  if (unknown.length) return { ok: false, code: 'UNKNOWN_PERMISSION', unknown };
  const permissions = sortByCatalog(input.filter(isPermissionKey));
  const present = new Set(permissions);
  const missing: DependencyGap[] = [];
  for (const permission of permissions) {
    for (const requires of PERMISSIONS[permission].requires) {
      if (!present.has(requires)) missing.push({ permission, requires });
    }
  }
  return missing.length ? { ok: false, code: 'PERMISSION_DEPENDENCY_MISSING', missing } : { ok: true, permissions };
}
