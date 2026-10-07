import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
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
    kind: varchar('kind', { length: 2 }).default('PJ').notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    tradeName: varchar('trade_name', { length: 200 }),
    taxId: varchar('tax_id', { length: 14 }),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 32 }),
    street: varchar('street', { length: 200 }),
    number: varchar('number', { length: 30 }),
    complement: varchar('complement', { length: 100 }),
    district: varchar('district', { length: 120 }),
    postalCode: varchar('postal_code', { length: 8 }),
    cityName: varchar('city_name', { length: 150 }),
    cityIbgeCode: varchar('city_ibge_code', { length: 7 }),
    stateCode: varchar('state_code', { length: 2 }),
    countryCode: varchar('country_code', { length: 2 }).default('BR').notNull(),
    municipalRegistration: varchar('municipal_registration', { length: 30 }),
    stateRegistration: varchar('state_registration', { length: 30 }),
    cnaeCode: varchar('cnae_code', { length: 7 }),
    simplesNationalOption: varchar('simples_national_option', { length: 1 }),
    simplesTaxationRegime: varchar('simples_taxation_regime', { length: 1 }),
    specialTaxRegime: varchar('special_tax_regime', { length: 1 }),
    timezone: varchar('timezone', { length: 64 }).default('America/Sao_Paulo').notNull(),
    locale: varchar('locale', { length: 16 }).default('pt-BR').notNull(),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    ...timestamps,
  },
  (table) => [
    check('companies_name_nonblank_chk', sql`length(btrim(${table.name})) > 0`),
    check('companies_kind_chk', sql`${table.kind} IN ('PF', 'PJ')`),
    check('companies_trade_name_kind_chk', sql`${table.kind} = 'PJ' OR ${table.tradeName} IS NULL`),
    check('companies_tax_id_chk', sql`${table.taxId} IS NULL OR (${table.kind} = 'PF' AND ${table.taxId} ~ '^[0-9]{11}$') OR (${table.kind} = 'PJ' AND ${table.taxId} ~ '^[A-Z0-9]{12}[0-9]{2}$')`),
    check('companies_postal_code_chk', sql`${table.postalCode} IS NULL OR ${table.postalCode} ~ '^[0-9]{8}$'`),
    check('companies_city_ibge_code_chk', sql`${table.cityIbgeCode} IS NULL OR ${table.cityIbgeCode} ~ '^[0-9]{7}$'`),
    check('companies_state_code_chk', sql`${table.stateCode} IS NULL OR ${table.stateCode} ~ '^[A-Z]{2}$'`),
    check('companies_country_code_chk', sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
    check('companies_cnae_code_chk', sql`${table.cnaeCode} IS NULL OR ${table.cnaeCode} ~ '^[0-9]{7}$'`),
    check('companies_simples_option_chk', sql`${table.simplesNationalOption} IS NULL OR ${table.simplesNationalOption} IN ('1','2','3','4')`),
    check('companies_simples_taxation_chk', sql`${table.simplesTaxationRegime} IS NULL OR ${table.simplesTaxationRegime} IN ('1','2','3')`),
    check('companies_special_tax_regime_chk', sql`${table.specialTaxRegime} IS NULL OR ${table.specialTaxRegime} IN ('0','1','2','3','4','5','6')`),
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

export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    internalCode: varchar('internal_code', { length: 20 }),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    unitLabel: varchar('unit_label', { length: 16 }).default('UN').notNull(),
    suggestedUnitPrice: numeric('suggested_unit_price', { precision: 15, scale: 2 }),
    nationalTaxCode: varchar('national_tax_code', { length: 6 }),
    nbsCode: varchar('nbs_code', { length: 9 }),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    createdByUserId: uuid('created_by_user_id'),
    ...timestamps,
  },
  (table) => [
    unique('services_company_id_id_uq').on(table.companyId, table.id),
    uniqueIndex('services_company_internal_code_uq')
      .on(table.companyId, sql`lower(${table.internalCode})`)
      .where(sql`${table.internalCode} IS NOT NULL`),
    index('services_company_status_name_id_idx').on(table.companyId, table.status, table.name, table.id),
    foreignKey({
      name: 'services_created_by_company_user_fk',
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('services_name_chk', sql`length(btrim(${table.name})) > 0`),
    check('services_unit_chk', sql`length(btrim(${table.unitLabel})) > 0`),
    check('services_internal_code_chk', sql`${table.internalCode} IS NULL OR length(btrim(${table.internalCode})) > 0`),
    check('services_description_chk', sql`${table.description} IS NULL OR char_length(${table.description}) <= 1000`),
    check('services_price_chk', sql`${table.suggestedUnitPrice} IS NULL OR ${table.suggestedUnitPrice} >= 0`),
    check('services_national_tax_code_chk', sql`${table.nationalTaxCode} IS NULL OR ${table.nationalTaxCode} ~ '^[0-9]{6}$'`),
    check('services_nbs_code_chk', sql`${table.nbsCode} IS NULL OR ${table.nbsCode} ~ '^[0-9]{9}$'`),
    check('services_status_chk', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const serviceMunicipalTaxCodes = pgTable(
  'service_municipal_tax_codes',
  {
    companyId: uuid('company_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    municipalityIbgeCode: varchar('municipality_ibge_code', { length: 7 }).notNull(),
    municipalTaxCode: varchar('municipal_tax_code', { length: 3 }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: 'service_municipal_tax_codes_pk', columns: [table.companyId, table.serviceId, table.municipalityIbgeCode] }),
    foreignKey({
      name: 'service_municipal_tax_codes_service_fk',
      columns: [table.companyId, table.serviceId],
      foreignColumns: [services.companyId, services.id],
    }).onDelete('restrict'),
    check('service_municipal_tax_codes_city_chk', sql`${table.municipalityIbgeCode} ~ '^[0-9]{7}$'`),
    check('service_municipal_tax_codes_code_chk', sql`${table.municipalTaxCode} ~ '^[0-9]{3}$'`),
  ],
);
