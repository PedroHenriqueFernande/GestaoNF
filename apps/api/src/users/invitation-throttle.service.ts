import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
@Injectable()
export class InvitationThrottleService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async check(ip: string, operation: string) {
    const key = createHash('sha256').update(`${operation}:${ip}`).digest('hex');
    const maximum = operation === 'preview' ? 100 : 20;
    const rows = await this.database.db.execute(sql`insert into invitation_request_limits (key,started_at,count) values (${key},now(),1)
      on conflict (key) do update set count=case when invitation_request_limits.started_at<now()-interval '15 minutes' then 1 else invitation_request_limits.count+1 end,
      started_at=case when invitation_request_limits.started_at<now()-interval '15 minutes' then now() else invitation_request_limits.started_at end
      where invitation_request_limits.started_at<now()-interval '15 minutes' or invitation_request_limits.count<${maximum} returning count`);
    if (!rows.length) throw new HttpException('Aguarde antes de tentar novamente', 429);
  }
}
