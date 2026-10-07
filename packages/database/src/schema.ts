import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  text,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    ...timestamps,
  },
  (table) => [
    check('companies_name_nonblank_chk', sql`length(btrim(${table.name})) > 0`),
    check('companies_status_chk', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    ...timestamps,
  },
  (table) => [
    check('users_name_nonblank_chk', sql`length(btrim(${table.name})) > 0`),
    check('users_email_normalized_chk', sql`${table.email} = lower(btrim(${table.email}))`),
    check('users_status_chk', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
    uniqueIndex('users_email_lower_uq').on(sql`lower(${table.email})`),
  ],
);

export const userCredentials = pgTable('user_credentials', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('auth_sessions_token_hash_uq').on(table.tokenHash), index('auth_sessions_user_id_idx').on(table.userId)],
);

export const companyUsers = pgTable(
  'company_users',
  {
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 20 }).notNull(),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'company_users_pk', columns: [table.companyId, table.userId] }),
    check('company_users_role_chk', sql`${table.role} IN ('OWNER', 'ADMIN', 'MANAGER', 'COLLABORATOR')`),
    check('company_users_status_chk', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
    index('company_users_user_id_idx').on(table.userId),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 2 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    tradeName: varchar('trade_name', { length: 200 }),
    taxId: varchar('tax_id', { length: 14 }),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 32 }),
    notes: text('notes'),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    street: varchar('street', { length: 200 }),
    number: varchar('number', { length: 30 }),
    complement: varchar('complement', { length: 100 }),
    district: varchar('district', { length: 120 }),
    postalCode: varchar('postal_code', { length: 8 }),
    cityName: varchar('city_name', { length: 150 }),
    cityIbgeCode: varchar('city_ibge_code', { length: 7 }),
    stateCode: varchar('state_code', { length: 2 }),
    countryCode: varchar('country_code', { length: 2 }).default('BR').notNull(),
    createdByUserId: uuid('created_by_user_id'),
    ...timestamps,
  },
  (table) => [
    unique('customers_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('customers_company_tax_id_uq')
      .on(table.companyId, table.taxId)
      .where(sql`${table.taxId} IS NOT NULL`),
    index('customers_company_name_id_idx').on(table.companyId, table.name, table.id),
    foreignKey({
      name: 'customers_created_by_company_user_fk',
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('customers_kind_chk', sql`${table.kind} IN ('PF', 'PJ')`),
    check('customers_name_nonblank_chk', sql`length(btrim(${table.name})) > 0`),
    check('customers_trade_name_kind_chk', sql`${table.kind} = 'PJ' OR ${table.tradeName} IS NULL`),
    check('customers_status_chk', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
    check(
      'customers_tax_id_shape_chk',
      sql`${table.taxId} IS NULL OR (${table.kind} = 'PF' AND ${table.taxId} ~ '^[0-9]{11}$') OR (${table.kind} = 'PJ' AND ${table.taxId} ~ '^[A-Z0-9]{12}[0-9]{2}$')`,
    ),
    check('customers_postal_code_chk', sql`${table.postalCode} IS NULL OR ${table.postalCode} ~ '^[0-9]{8}$'`),
    check('customers_city_ibge_code_chk', sql`${table.cityIbgeCode} IS NULL OR ${table.cityIbgeCode} ~ '^[0-9]{7}$'`),
    check('customers_state_code_chk', sql`${table.stateCode} IS NULL OR ${table.stateCode} ~ '^[A-Z]{2}$'`),
    check('customers_country_code_chk', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
  ],
);
