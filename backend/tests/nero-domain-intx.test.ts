// backend/tests/nero-domain-intx.test.ts — TEMPORÁRIO
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { createNeroTestEnv, seedOperator, VALID_CPF, VALID_CPF_2, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
let customers: CustomersService;
let services: ServicesService;
beforeAll(async () => {
  env = await createNeroTestEnv();
  customers = new CustomersService(env.database);
  services = new ServicesService(env.database);
}, 120_000);
afterAll(async () => { await env?.close(); });

class Sentinel extends Error {}

async function rollback<T>(work: (tx: Parameters<Parameters<typeof env.db.transaction>[0]>[0]) => Promise<T>) {
  let result: T | undefined;
  await expect(env.db.transaction(async (tx) => { result = await work(tx); throw new Sentinel(); })).rejects.toBeInstanceOf(Sentinel);
  return result as T;
}

async function setup(name: string) {
  const operator = await seedOperator(env, [name]);
  return { companyId: operator.companies[0].id, userId: operator.userId };
}

describe('CustomersService.updateInTx', () => {
  it('dentro de transação revertida não persiste e devolve antes e depois', async () => {
    const { companyId, userId } = await setup('Clientes rollback');
    const created = await customers.create(companyId, userId, { kind: 'PF', name: 'Ana', phone: '61999990000' });
    const { before, after } = await rollback((tx) => customers.updateInTx(tx, companyId, created.id, { phone: '61988887777' }));
    expect(before.phone).toBe('61999990000');
    expect(after.phone).toBe('61988887777');
    expect((await customers.get(companyId, created.id)).phone).toBe('61999990000');
  });

  it('a API continua: altera, valida CPF, recusa duplicidade e outra empresa', async () => {
    const { companyId, userId } = await setup('Clientes API');
    const other = await setup('Clientes API outra');
    const ana = await customers.create(companyId, userId, { kind: 'PF', name: 'Ana', taxId: VALID_CPF });
    const bia = await customers.create(companyId, userId, { kind: 'PF', name: 'Bia', taxId: VALID_CPF_2 });
    expect((await customers.update(companyId, ana.id, { phone: '61977776666' })).phone).toBe('61977776666');
    await expect(customers.update(companyId, ana.id, { taxId: '12345678900' })).rejects.toThrowError(new BadRequestException('CPF inválido'));
    await expect(customers.update(companyId, bia.id, { taxId: VALID_CPF })).rejects.toThrowError(new ConflictException('CPF/CNPJ já cadastrado nesta empresa'));
    await expect(customers.update(other.companyId, ana.id, { phone: '1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createInTx converte duplicidade em ConflictException', async () => {
    const { companyId, userId } = await setup('Clientes create');
    await customers.create(companyId, userId, { kind: 'PF', name: 'Ana', taxId: VALID_CPF });
    await expect(env.db.transaction((tx) => customers.createInTx(tx, companyId, userId, { kind: 'PF', name: 'Outra Ana', taxId: VALID_CPF })))
      .rejects.toThrowError(new ConflictException('CPF/CNPJ já cadastrado nesta empresa'));
  });
});

describe('ServicesService.updateInTx', () => {
  it('dentro de transação revertida não persiste e devolve antes e depois', async () => {
    const { companyId, userId } = await setup('Serviços rollback');
    const created = await services.create(companyId, userId, { name: 'Site', unitLabel: 'UN', suggestedUnitPrice: '100.00' });
    const { before, after } = await rollback((tx) => services.updateInTx(tx, companyId, created.id, { suggestedUnitPrice: '150.00' }));
    expect(before.suggestedUnitPrice).toBe('100.00');
    expect(after.suggestedUnitPrice).toBe('150.00');
    expect(after.fiscalClassificationStatus).toBe('PENDING_NATIONAL_CODE');
    expect((await services.get(companyId, created.id)).suggestedUnitPrice).toBe('100.00');
  });

  it('a API continua: altera, recusa código interno repetido e outra empresa', async () => {
    const { companyId, userId } = await setup('Serviços API');
    const other = await setup('Serviços API outra');
    const a = await services.create(companyId, userId, { name: 'A', unitLabel: 'UN', internalCode: 'X1' });
    const b = await services.create(companyId, userId, { name: 'B', unitLabel: 'UN', internalCode: 'X2' });
    expect((await services.update(companyId, a.id, { name: 'A2' })).name).toBe('A2');
    await expect(services.update(companyId, b.id, { internalCode: 'X1' })).rejects.toThrowError(new ConflictException('Código interno já cadastrado nesta empresa'));
    await expect(services.update(other.companyId, a.id, { name: 'Z' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.db.transaction((tx) => services.createInTx(tx, companyId, userId, { name: 'C', unitLabel: 'UN', internalCode: 'X1' })))
      .rejects.toThrowError(new ConflictException('Código interno já cadastrado nesta empresa'));
    expect(await env.db.select().from(schema.services).where(eq(schema.services.companyId, companyId))).toHaveLength(2);
  });
});
