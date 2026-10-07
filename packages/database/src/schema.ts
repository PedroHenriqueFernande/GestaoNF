import { sql } from 'drizzle-orm';
import {
  check,
  char,
  date,
  foreignKey,
  index,
  integer,
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

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    orderCode: char('order_code', { length: 5 }).notNull(),
    workOrderNumber: varchar('work_order_number', { length: 40 }),
    customerId: uuid('customer_id').notNull(),
    customerKindSnapshot: varchar('customer_kind_snapshot', { length: 2 }).notNull(),
    customerNameSnapshot: varchar('customer_name_snapshot', { length: 200 }).notNull(),
    customerTaxIdSnapshot: varchar('customer_tax_id_snapshot', { length: 14 }),
    status: varchar('status', { length: 16 }).default('DRAFT').notNull(),
    soldOn: date('sold_on'),
    subtotalAmount: numeric('subtotal_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
    discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    version: integer('version').default(1).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('sales_company_id_id_uq').on(table.companyId, table.id),
    unique('sales_company_order_code_uq').on(table.companyId, table.orderCode),
    unique('sales_company_idempotency_key_uq').on(table.companyId, table.idempotencyKey),
    index('sales_company_status_date_id_idx').on(table.companyId, table.status, table.soldOn.desc(), table.id),
    index('sales_company_customer_date_id_idx').on(table.companyId, table.customerId, table.soldOn.desc(), table.id),
    index('sales_company_work_order_number_idx').on(table.companyId, table.workOrderNumber)
      .where(sql`${table.workOrderNumber} IS NOT NULL`),
    foreignKey({
      name: 'sales_customer_company_fk',
      columns: [table.companyId, table.customerId],
      foreignColumns: [customers.companyId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_created_by_company_user_fk',
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('sales_order_code_chk', sql`${table.orderCode} ~ '^[0-9]{5}$'`),
    check('sales_work_order_number_chk', sql`${table.workOrderNumber} IS NULL OR length(btrim(${table.workOrderNumber})) > 0`),
    check('sales_customer_kind_snapshot_chk', sql`${table.customerKindSnapshot} IN ('PF', 'PJ')`),
    check('sales_customer_name_snapshot_chk', sql`length(btrim(${table.customerNameSnapshot})) > 0`),
    check('sales_customer_tax_id_snapshot_chk', sql`${table.customerTaxIdSnapshot} IS NULL OR (${table.customerKindSnapshot} = 'PF' AND ${table.customerTaxIdSnapshot} ~ '^[0-9]{11}$') OR (${table.customerKindSnapshot} = 'PJ' AND ${table.customerTaxIdSnapshot} ~ '^[A-Z0-9]{12}[0-9]{2}$')`),
    check('sales_status_chk', sql`${table.status} IN ('DRAFT', 'CONFIRMED', 'CANCELED')`),
    check('sales_amounts_chk', sql`${table.subtotalAmount} >= 0 AND ${table.discountAmount} >= 0 AND ${table.discountAmount} <= ${table.subtotalAmount} AND ${table.totalAmount} = ${table.subtotalAmount} - ${table.discountAmount}`),
    check('sales_version_chk', sql`${table.version} > 0`),
    check('sales_confirmed_chk', sql`${table.status} <> 'CONFIRMED' OR (${table.soldOn} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL AND ${table.totalAmount} > 0)`),
    check('sales_canceled_chk', sql`(${table.status} = 'CANCELED') = (${table.canceledAt} IS NOT NULL)`),
    check('sales_request_hash_chk', sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    position: integer('position').notNull(),
    serviceNameSnapshot: varchar('service_name_snapshot', { length: 200 }).notNull(),
    descriptionSnapshot: text('description_snapshot'),
    unitLabelSnapshot: varchar('unit_label_snapshot', { length: 16 }).notNull(),
    nationalTaxCodeSnapshot: varchar('national_tax_code_snapshot', { length: 6 }),
    nbsCodeSnapshot: varchar('nbs_code_snapshot', { length: 9 }),
    quantity: numeric('quantity', { precision: 15, scale: 4 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
    grossAmount: numeric('gross_amount', { precision: 15, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
    performedOn: date('performed_on'),
    ...timestamps,
  },
  (table) => [
    unique('sale_items_company_sale_position_uq').on(table.companyId, table.saleId, table.position),
    foreignKey({
      name: 'sale_items_sale_company_fk',
      columns: [table.companyId, table.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sale_items_service_company_fk',
      columns: [table.companyId, table.serviceId],
      foreignColumns: [services.companyId, services.id],
    }).onDelete('restrict'),
    check('sale_items_position_chk', sql`${table.position} > 0`),
    check('sale_items_name_chk', sql`length(btrim(${table.serviceNameSnapshot})) > 0`),
    check('sale_items_unit_chk', sql`length(btrim(${table.unitLabelSnapshot})) > 0`),
    check('sale_items_description_chk', sql`${table.descriptionSnapshot} IS NULL OR char_length(${table.descriptionSnapshot}) <= 1000`),
    check('sale_items_national_tax_code_chk', sql`${table.nationalTaxCodeSnapshot} IS NULL OR ${table.nationalTaxCodeSnapshot} ~ '^[0-9]{6}$'`),
    check('sale_items_nbs_code_chk', sql`${table.nbsCodeSnapshot} IS NULL OR ${table.nbsCodeSnapshot} ~ '^[0-9]{9}$'`),
    check('sale_items_amounts_chk', sql`${table.quantity} > 0 AND ${table.unitPrice} >= 0 AND ${table.grossAmount} = round(${table.quantity} * ${table.unitPrice}, 2) AND ${table.discountAmount} >= 0 AND ${table.discountAmount} <= ${table.grossAmount} AND ${table.totalAmount} = ${table.grossAmount} - ${table.discountAmount}`),
  ],
);

export const saleInstallments = pgTable(
  'sale_installments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    number: integer('number').notNull(),
    controlCode: char('control_code', { length: 4 }),
    paymentMethod: varchar('payment_method', { length: 24 }).notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    dueOn: date('due_on'),
    initialReceivedOn: date('initial_received_on'),
    ...timestamps,
  },
  (table) => [
    unique('sale_installments_company_sale_id_uq').on(table.companyId, table.saleId, table.id),
    unique('sale_installments_company_sale_number_uq').on(table.companyId, table.saleId, table.number),
    uniqueIndex('sale_installments_company_sale_code_uq').on(table.companyId, table.saleId, table.controlCode)
      .where(sql`${table.controlCode} IS NOT NULL`),
    index('sale_installments_company_due_on_idx').on(table.companyId, table.dueOn),
    foreignKey({
      name: 'sale_installments_sale_company_fk',
      columns: [table.companyId, table.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete('restrict'),
    check('sale_installments_number_chk', sql`${table.number} > 0`),
    check('sale_installments_code_chk', sql`${table.controlCode} IS NULL OR ${table.controlCode} ~ '^[0-9]{4}$'`),
    check('sale_installments_method_chk', sql`${table.paymentMethod} IN ('PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER')`),
    check('sale_installments_amount_chk', sql`${table.amount} > 0`),
    check('sale_installments_payment_date_chk', sql`(${table.dueOn} IS NOT NULL AND ${table.initialReceivedOn} IS NULL) OR (${table.dueOn} IS NULL AND ${table.initialReceivedOn} IS NOT NULL)`),
  ],
);

export const receivables = pgTable(
  'receivables',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    saleInstallmentId: uuid('sale_installment_id').notNull(),
    originalAmount: numeric('original_amount', { precision: 15, scale: 2 }).notNull(),
    dueOn: date('due_on'),
    ...timestamps,
  },
  (table) => [
    unique('receivables_company_id_uq').on(table.companyId, table.id),
    unique('receivables_company_installment_uq').on(table.companyId, table.saleInstallmentId),
    index('receivables_company_due_on_idx').on(table.companyId, table.dueOn),
    foreignKey({
      name: 'receivables_installment_company_sale_fk',
      columns: [table.companyId, table.saleId, table.saleInstallmentId],
      foreignColumns: [saleInstallments.companyId, saleInstallments.saleId, saleInstallments.id],
    }).onDelete('restrict'),
    check('receivables_amount_chk', sql`${table.originalAmount} > 0`),
  ],
);

export const receivableMovements = pgTable(
  'receivable_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    receivableId: uuid('receivable_id').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    effectiveOn: date('effective_on').notNull(),
    paymentMethod: varchar('payment_method', { length: 24 }),
    reference: varchar('reference', { length: 100 }),
    reversesMovementId: uuid('reverses_movement_id'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    idempotencyKey: uuid('idempotency_key'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('receivable_movements_company_receivable_id_uq').on(table.companyId, table.receivableId, table.id),
    uniqueIndex('receivable_movements_company_idempotency_key_uq').on(table.companyId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    uniqueIndex('receivable_movements_one_reversal_uq').on(table.companyId, table.reversesMovementId)
      .where(sql`${table.reversesMovementId} IS NOT NULL`),
    index('receivable_movements_company_receivable_recorded_idx').on(table.companyId, table.receivableId, table.recordedAt),
    foreignKey({
      name: 'receivable_movements_receivable_company_fk',
      columns: [table.companyId, table.receivableId],
      foreignColumns: [receivables.companyId, receivables.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'receivable_movements_reversal_same_receivable_fk',
      columns: [table.companyId, table.receivableId, table.reversesMovementId],
      foreignColumns: [table.companyId, table.receivableId, table.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'receivable_movements_created_by_company_user_fk',
      columns: [table.companyId, table.createdByUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('receivable_movements_amount_chk', sql`${table.amount} > 0`),
    check('receivable_movements_kind_chk', sql`(${table.kind} = 'RECEIPT' AND ${table.reversesMovementId} IS NULL AND ${table.paymentMethod} IS NOT NULL AND ${table.paymentMethod} IN ('PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER')) OR (${table.kind} = 'REVERSAL' AND ${table.reversesMovementId} IS NOT NULL AND ${table.paymentMethod} IS NULL)`),
    check('receivable_movements_not_self_reversal_chk', sql`${table.reversesMovementId} IS NULL OR ${table.reversesMovementId} <> ${table.id}`),
    check('receivable_movements_reference_chk', sql`${table.reference} IS NULL OR length(btrim(${table.reference})) > 0`),
  ],
);

export const saleStatusHistory = pgTable(
  'sale_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    fromStatus: varchar('from_status', { length: 16 }),
    toStatus: varchar('to_status', { length: 16 }).notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('sale_status_history_company_sale_occurred_idx').on(table.companyId, table.saleId, table.occurredAt),
    foreignKey({
      name: 'sale_status_history_sale_company_fk',
      columns: [table.companyId, table.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sale_status_history_actor_company_fk',
      columns: [table.companyId, table.actorUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('sale_status_history_from_chk', sql`${table.fromStatus} IS NULL OR ${table.fromStatus} IN ('DRAFT', 'CONFIRMED', 'CANCELED')`),
    check('sale_status_history_to_chk', sql`${table.toStatus} IN ('DRAFT', 'CONFIRMED', 'CANCELED')`),
    check('sale_status_history_transition_chk', sql`${table.fromStatus} IS DISTINCT FROM ${table.toStatus} AND (${table.fromStatus} IS NOT NULL OR ${table.toStatus} = 'DRAFT')`),
    check('sale_status_history_reason_chk', sql`(${table.toStatus} <> 'CANCELED' OR (${table.reason} IS NOT NULL AND length(btrim(${table.reason})) > 0)) AND (${table.reason} IS NULL OR length(btrim(${table.reason})) > 0)`),
  ],
);

export const saleReferenceHistory = pgTable(
  'sale_reference_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    oldWorkOrderNumber: varchar('old_work_order_number', { length: 40 }),
    newWorkOrderNumber: varchar('new_work_order_number', { length: 40 }),
    actorUserId: uuid('actor_user_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('sale_reference_history_company_sale_occurred_idx').on(table.companyId, table.saleId, table.occurredAt),
    foreignKey({
      name: 'sale_reference_history_sale_company_fk',
      columns: [table.companyId, table.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sale_reference_history_actor_company_fk',
      columns: [table.companyId, table.actorUserId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('sale_reference_history_changed_chk', sql`${table.oldWorkOrderNumber} IS DISTINCT FROM ${table.newWorkOrderNumber}`),
    check('sale_reference_history_old_chk', sql`${table.oldWorkOrderNumber} IS NULL OR length(btrim(${table.oldWorkOrderNumber})) > 0`),
    check('sale_reference_history_new_chk', sql`${table.newWorkOrderNumber} IS NULL OR length(btrim(${table.newWorkOrderNumber})) > 0`),
  ],
);
