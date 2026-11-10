import { z } from 'zod';

export const sendMessageSchema = z.strictObject({ text: z.string().trim().min(1, 'Escreva sua mensagem').max(1000, 'Use até 1000 caracteres') });
export const actionIdSchema = z.uuid();
export const helpIdSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);
