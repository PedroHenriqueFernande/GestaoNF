import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException({ message: 'Dados inválidos', errors: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  return result.data;
}

export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}
