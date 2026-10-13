import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class MetaSignatureService {
  verify(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) throw new UnauthorizedException('META_APP_SECRET não configurado');
    const received = signature?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
    if (!received) throw new UnauthorizedException('Assinatura Meta ausente ou inválida');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'))) {
      throw new UnauthorizedException('Assinatura Meta inválida');
    }
  }
}

