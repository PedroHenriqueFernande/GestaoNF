import { HttpException } from '@nestjs/common';
import { isPermissionDenial, NOT_ALLOWED_GUIDANCE } from '../permissions/actor.js';

export function httpMessage(error: HttpException): string {
  if (isPermissionDenial(error)) return NOT_ALLOWED_GUIDANCE; // D16: o modelo e o cartão não citam a permissão
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : error.message;
}
