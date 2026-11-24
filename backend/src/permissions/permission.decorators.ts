import 'reflect-metadata';
import { isPermissionKey, type PermissionKey } from '@gestaonf/permissions';
import type { PermissionPolicy } from './actor.js';

const POLICY_KEY = Symbol('gestaonf:permission-policy');

/** Exatamente uma política por rota (Spec 7.5, item 1): a segunda quebra na carga da classe. */
function declare(policy: PermissionPolicy): MethodDecorator {
  if ('keys' in policy && (policy.keys.length === 0 || !policy.keys.every(isPermissionKey))) {
    throw new Error(`Política com chave inválida: ${policy.keys.join(', ')}`);
  }
  return (_target, propertyKey, descriptor) => {
    const handler = descriptor.value;
    if (typeof handler !== 'function') throw new Error('Políticas de permissão exigem um método');
    if (Reflect.hasOwnMetadata(POLICY_KEY, handler)) throw new Error(`A rota ${String(propertyKey)} declara mais de uma política de permissão`);
    Reflect.defineMetadata(POLICY_KEY, policy, handler);
  };
}

export const RequirePermission = (key: PermissionKey) => declare({ kind: 'all', keys: [key] });
export const RequireAllPermissions = (keys: readonly [PermissionKey, PermissionKey, ...PermissionKey[]]) => declare({ kind: 'all', keys });
export const RequireAnyPermission = (keys: readonly [PermissionKey, PermissionKey, ...PermissionKey[]]) => declare({ kind: 'any', keys });
/** Vínculo ativo basta (Spec 4.13). */
export const AnyMember = () => declare({ kind: 'member' });
/** Só o titular da contratação dona da empresa (Spec 4.11). */
export const AccountOwnerOnly = () => declare({ kind: 'owner' });

export function policyOf(handler: unknown): PermissionPolicy | undefined {
  return typeof handler === 'function' ? Reflect.getOwnMetadata(POLICY_KEY, handler) as PermissionPolicy | undefined : undefined;
}
