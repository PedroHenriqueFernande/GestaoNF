// backend/src/assistant/tools/customer-operations.ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { CustomersService } from '../../customers/customers.service.js';
import { createCustomerSchema, updateCustomerSchema } from '../../customers/customers.schemas.js';
import { rules } from '../nero-policy.js';
import type { WriteOperation } from './types.js';
import { assertExpectedVersion, describeChanges, describeFields, providedFields } from './write-support.js';

const CUSTOMER_FIELDS = 'kind ("PF" ou "PJ", obrigatório na criação), name (obrigatório na criação), tradeName (só PJ), taxId (CPF ou CNPJ, só dígitos), email, phone, notes, status ("ACTIVE"/"INACTIVE"), street, number, complement, district, postalCode, cityName, cityIbgeCode, stateCode, countryCode (país com 2 letras ISO, ex.: "BR" ou "US"), municipalRegistration (inscrição municipal), caepfCode (14 dígitos, somente PF), foreignTaxId (documento fiscal estrangeiro), noForeignTaxIdReason ("1" = Dispensado desse documento; "2" = O país não exige esse documento; nunca junto com foreignTaxId), foreignPostalCode (CEP estrangeiro), foreignStateProvince (estado/província estrangeiro)';

export function createCustomerOperation(customers: CustomersService): WriteOperation<z.output<typeof createCustomerSchema>> {
  return {
    kind: 'WRITE', name: 'criar_cliente', allowed: rules.anyMember, versionScope: 'customer',
    description: `Cadastra um cliente. dados: {${CUSTOMER_FIELDS}}. Antes de criar, busque com buscar_clientes para não duplicar. CPF/CNPJ é opcional.`,
    schema: createCustomerSchema,
    summarize: (args) => `Novo cliente: ${describeFields(args)}`,
    async execute(tx, ctx, args) {
      const customer = await customers.createInTx(tx, ctx.companyId, ctx.userId, args);
      return { entityId: customer.id, label: `Cliente ${customer.name}`, summary: `Novo cliente: ${describeFields(providedFields(customer, args))}` };
    },
  };
}

const updateArgs = z.object({ id: z.uuid(), alteracoes: updateCustomerSchema }).strict();

export function updateCustomerOperation(customers: CustomersService): WriteOperation<z.output<typeof updateArgs>> {
  return {
    kind: 'WRITE', name: 'alterar_cliente', allowed: rules.anyMember, versionScope: 'customer', requiresVersion: true,
    description: `Altera um cliente existente. dados: {"id": id do cliente vindo de buscar_clientes (ou {"$ref": n} de um cliente criado no mesmo lote), "alteracoes": {só os campos que mudam: ${CUSTOMER_FIELDS}}}. Para inativar use status "INACTIVE".`,
    schema: updateArgs,
    summarize: (args) => `Alterar cliente: ${describeFields((args.alteracoes ?? {}) as Record<string, unknown>)}`,
    async execute(tx, ctx, args, options) {
      const { before, after } = await customers.updateInTx(tx, ctx.companyId, args.id, args.alteracoes);
      assertExpectedVersion(before.updatedAt, options.expectedVersion);
      const changes = describeChanges(before, args.alteracoes);
      if (changes === 'nenhuma mudança') throw new BadRequestException(`Os dados informados já são os atuais do cliente ${before.name}`);
      return { entityId: after.id, label: `Cliente ${after.name}`, summary: `Alterar cliente ${before.name}: ${changes}`, version: before.updatedAt.toISOString() };
    },
  };
}
