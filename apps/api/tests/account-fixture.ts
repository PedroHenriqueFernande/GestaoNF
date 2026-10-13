import { accounts, accountSubscriptions } from '@gestaonf/database/schema';
import { randomUUID } from 'node:crypto';
import type { DatabaseService } from '../src/database/database.module.js';
export async function testAccount(db: Pick<DatabaseService['db'], 'insert'>, ownerUserId: string) {
  const [account] = await db.insert(accounts).values({ ownerUserId, name: 'Conta de teste', status: 'ACTIVE', requestKey: randomUUID(), requestHash: '0'.repeat(64) }).returning();
  await db.insert(accountSubscriptions).values({ accountId: account.id, status: 'ACTIVE', source: 'LEGACY_DEV' });
  return account.id;
}
