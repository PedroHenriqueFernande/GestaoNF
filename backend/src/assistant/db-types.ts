// backend/src/assistant/db-types.ts
import type { DatabaseService } from '../database/database.module.js';

export type Db = DatabaseService['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbExecutor = Db | Tx;
