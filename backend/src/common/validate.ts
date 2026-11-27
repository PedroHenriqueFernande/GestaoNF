import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({ message: 'Dados inválidos', errors: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  return result.data;
}

function hasPostgresErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === code) return true;
  return 'cause' in error && hasPostgresErrorCode(error.cause, code);
}

export const isUniqueViolation = (error: unknown) => hasPostgresErrorCode(error, '23505');
export const isForeignKeyViolation = (error: unknown) => hasPostgresErrorCode(error, '23503');
