// backend/src/assistant/tools/service-operations.ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { ServicesService } from '../../services/services.service.js';
import { createServiceSchema, updateServiceSchema } from '../../services/services.schemas.js';
import { rules } from '../nero-policy.js';
import type { WriteOperation } from './types.js';
import { assertExpectedVersion, describeChanges, describeFields, providedFields } from './write-support.js';

const SERVICE_FIELDS = 'name (obrigatório na criação), internalCode, description, unitLabel, suggestedUnitPrice (ex.: "5000.00"), nationalTaxCode (6 dígitos), nbsCode (9 dígitos), simplesActivityCode, status ("ACTIVE"/"INACTIVE")';

export function createServiceOperation(services: ServicesService): WriteOperation<z.output<typeof createServiceSchema>> {
  return {
    kind: 'WRITE', name: 'criar_servico', allowed: rules.anyMember, versionScope: 'service',
    description: `Cadastra um serviço. dados: {${SERVICE_FIELDS}}. Antes de criar, busque com buscar_servicos para não duplicar.`,
    schema: createServiceSchema,
    summarize: (args) => `Novo serviço: ${describeFields(args)}`,
    async execute(tx, ctx, args) {
      const service = await services.createInTx(tx, ctx.companyId, ctx.userId, args);
      return { entityId: service.id, label: `Serviço ${service.name}`, summary: `Novo serviço: ${describeFields(providedFields(service, args))}` };
    },
  };
}

const updateArgs = z.object({ id: z.uuid(), alteracoes: updateServiceSchema }).strict();

export function updateServiceOperation(services: ServicesService): WriteOperation<z.output<typeof updateArgs>> {
  return {
    kind: 'WRITE', name: 'alterar_servico', allowed: rules.anyMember, versionScope: 'service', requiresVersion: true,
    description: `Altera um serviço existente. dados: {"id": id do serviço vindo de buscar_servicos (ou {"$ref": n} de um serviço criado no mesmo lote), "alteracoes": {só os campos que mudam: ${SERVICE_FIELDS}}}. Para inativar use status "INACTIVE".`,
    schema: updateArgs,
    summarize: (args) => `Alterar serviço: ${describeFields((args.alteracoes ?? {}) as Record<string, unknown>)}`,
    async execute(tx, ctx, args, options) {
      const { before, after } = await services.updateInTx(tx, ctx.companyId, args.id, args.alteracoes);
      assertExpectedVersion(before.updatedAt, options.expectedVersion);
      const changes = describeChanges(before, args.alteracoes);
      if (changes === 'nenhuma mudança') throw new BadRequestException(`Os dados informados já são os atuais do serviço ${before.name}`);
      return { entityId: after.id, label: `Serviço ${after.name}`, summary: `Alterar serviço ${before.name}: ${changes}`, version: before.updatedAt.toISOString() };
    },
  };
}
