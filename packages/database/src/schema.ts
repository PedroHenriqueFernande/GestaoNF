import { sql } from 'drizzle-orm';
import {
  check,
  char,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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
    index('sales_company_finance_recent_idx').on(table.companyId, table.confirmedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'CONFIRMED'`),
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
    paycode: char('paycode', { length: 4 }),
    paymentMethod: varchar('payment_method', { length: 24 }).notNull(),
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    dueOn: date('due_on'),
    initialReceivedOn: date('initial_received_on'),
    ...timestamps,
  },
  (table) => [
    unique('sale_installments_company_sale_id_uq').on(table.companyId, table.saleId, table.id),
    unique('sale_installments_company_sale_number_uq').on(table.companyId, table.saleId, table.number),
    uniqueIndex('sale_installments_company_sale_paycode_uq').on(table.companyId, table.saleId, table.paycode)
      .where(sql`${table.paycode} IS NOT NULL`),
    index('sale_installments_company_paycode_idx').on(table.companyId, table.paycode, table.saleId)
      .where(sql`${table.paycode} IS NOT NULL`),
    index('sale_installments_company_due_on_idx').on(table.companyId, table.dueOn),
    foreignKey({
      name: 'sale_installments_sale_company_fk',
      columns: [table.companyId, table.saleId],
      foreignColumns: [sales.companyId, sales.id],
    }).onDelete('restrict'),
    check('sale_installments_number_chk', sql`${table.number} > 0`),
    check('sale_installments_paycode_chk', sql`${table.paycode} IS NULL OR ${table.paycode} ~ '^[0-9]{4}$'`),
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
    index('receivables_company_sale_idx').on(table.companyId, table.saleId, table.saleInstallmentId),
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
    index('receivable_movements_company_receipt_date_idx').on(table.companyId, table.effectiveOn, table.receivableId)
      .where(sql`${table.kind} = 'RECEIPT'`),
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

export const whatsappConnections = pgTable(
  'whatsapp_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownership: varchar('ownership', { length: 16 }).default('PLATFORM').notNull(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    environment: varchar('environment', { length: 16 }).default('DEVELOPMENT').notNull(),
    metaAppId: varchar('meta_app_id', { length: 80 }).notNull(),
    businessPortfolioId: varchar('business_portfolio_id', { length: 80 }),
    messagingAccountId: varchar('messaging_account_id', { length: 80 }).notNull(),
    phoneNumberId: varchar('phone_number_id', { length: 80 }).notNull(),
    whatsappAccountId: varchar('whatsapp_account_id', { length: 80 }),
    displayPhoneNumber: varchar('display_phone_number', { length: 32 }).notNull(),
    graphApiVersion: varchar('graph_api_version', { length: 16 }).default('v26.0').notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    ...timestamps,
  },
  (table) => [
    unique('whatsapp_connections_environment_phone_uq').on(table.environment, table.phoneNumberId),
    index('whatsapp_connections_company_status_idx').on(table.companyId, table.status),
    check('whatsapp_connections_ownership_chk', sql`${table.ownership} IN ('PLATFORM', 'COMPANY')`),
    check('whatsapp_connections_environment_chk', sql`${table.environment} IN ('DEVELOPMENT', 'PRODUCTION')`),
    check('whatsapp_connections_status_chk', sql`${table.status} IN ('ACTIVE', 'INACTIVE', 'ERROR')`),
    check('whatsapp_connections_owner_chk', sql`(${table.ownership} = 'PLATFORM' AND ${table.companyId} IS NULL) OR (${table.ownership} = 'COMPANY' AND ${table.companyId} IS NOT NULL)`),
  ],
);

export const whatsappLinks = pgTable(
  'whatsapp_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    senderId: varchar('sender_id', { length: 80 }).notNull(),
    senderIdKind: varchar('sender_id_kind', { length: 16 }).default('WA_ID').notNull(),
    phoneE164: varchar('phone_e164', { length: 20 }),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('whatsapp_links_connection_sender_active_uq').on(table.connectionId, table.senderId)
      .where(sql`${table.status} = 'ACTIVE'`),
    unique('whatsapp_links_identity_owner_uq').on(table.id, table.connectionId, table.userId),
    index('whatsapp_links_user_status_idx').on(table.userId, table.status),
    check('whatsapp_links_sender_kind_chk', sql`${table.senderIdKind} IN ('WA_ID', 'PHONE')`),
    check('whatsapp_links_status_chk', sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
    check('whatsapp_links_revoked_chk', sql`(${table.status} = 'REVOKED') = (${table.revokedAt} IS NOT NULL)`),
  ],
);

export const whatsappLinkChallenges = pgTable(
  'whatsapp_link_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    mode: varchar('mode', { length: 20 }).default('NEW_NUMBER').notNull(),
    expectedLinkId: uuid('expected_link_id').references(() => whatsappLinks.id, { onDelete: 'restrict' }),
    candidateSenderId: varchar('candidate_sender_id', { length: 80 }),
    candidatePhoneE164: varchar('candidate_phone_e164', { length: 20 }),
    attempts: integer('attempts').default(0).notNull(),
    status: varchar('status', { length: 16 }).default('PENDING').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('whatsapp_link_challenges_token_uq').on(table.tokenHash),
    index('whatsapp_link_challenges_user_status_idx').on(table.userId, table.status, table.expiresAt),
    foreignKey({
      name: 'whatsapp_link_challenges_company_user_fk',
      columns: [table.companyId, table.userId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('whatsapp_link_challenges_attempts_chk', sql`${table.attempts} >= 0`),
    check('whatsapp_link_challenges_mode_chk', sql`(${table.mode} = 'NEW_NUMBER' AND ${table.expectedLinkId} IS NULL) OR (${table.mode} = 'EXISTING_NUMBER' AND ${table.expectedLinkId} IS NOT NULL)`),
    check('whatsapp_link_challenges_status_chk', sql`${table.status} IN ('PENDING', 'CANDIDATE', 'CONFIRMED', 'EXPIRED', 'CANCELED')`),
  ],
);

export const whatsappLinkCompanies = pgTable('whatsapp_link_companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  linkId: uuid('link_id').notNull(),
  connectionId: uuid('connection_id').notNull(),
  userId: uuid('user_id').notNull(),
  companyId: uuid('company_id').notNull(),
  challengeId: uuid('challenge_id').notNull().references(() => whatsappLinkChallenges.id, { onDelete: 'restrict' }),
  status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  foreignKey({ name: 'whatsapp_link_companies_identity_fk', columns: [table.linkId, table.connectionId, table.userId], foreignColumns: [whatsappLinks.id, whatsappLinks.connectionId, whatsappLinks.userId] }).onDelete('restrict'),
  foreignKey({ name: 'whatsapp_link_companies_membership_fk', columns: [table.companyId, table.userId], foreignColumns: [companyUsers.companyId, companyUsers.userId] }).onDelete('restrict'),
  unique('whatsapp_link_companies_context_uq').on(table.id, table.linkId, table.companyId, table.userId),
  uniqueIndex('whatsapp_link_companies_user_company_active_uq').on(table.connectionId, table.userId, table.companyId).where(sql`${table.status} = 'ACTIVE'`),
  uniqueIndex('whatsapp_link_companies_link_company_active_uq').on(table.linkId, table.companyId).where(sql`${table.status} = 'ACTIVE'`),
  check('whatsapp_link_companies_status_chk', sql`${table.status} IN ('ACTIVE', 'REVOKED')`),
  check('whatsapp_link_companies_revoked_chk', sql`(${table.status} = 'REVOKED') = (${table.revokedAt} IS NOT NULL)`),
]);

export const whatsappSessions = pgTable(
  'whatsapp_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id').notNull().references(() => whatsappLinks.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    activeCompanyId: uuid('active_company_id'),
    mode: varchar('mode', { length: 16 }).default('NORMAL').notNull(),
    contextVersion: integer('context_version').default(1).notNull(),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique('whatsapp_sessions_link_uq').on(table.linkId),
    foreignKey({
      name: 'whatsapp_sessions_active_company_user_fk',
      columns: [table.activeCompanyId, table.userId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('whatsapp_sessions_mode_chk', sql`${table.mode} IN ('NORMAL', 'AWAITING_CONFIRMATION', 'PAUSED')`),
    check('whatsapp_sessions_context_version_chk', sql`${table.contextVersion} > 0`),
  ],
);

export const whatsappConsentEvents = pgTable(
  'whatsapp_consent_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    linkId: uuid('link_id').notNull().references(() => whatsappLinks.id, { onDelete: 'restrict' }),
    companyLinkId: uuid('company_link_id').references(() => whatsappLinkCompanies.id, { onDelete: 'restrict' }),
    event: varchar('event', { length: 16 }).notNull(),
    source: varchar('source', { length: 20 }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('whatsapp_consent_events_link_date_idx').on(table.linkId, table.occurredAt),
    check('whatsapp_consent_events_event_chk', sql`${table.event} IN ('GRANTED', 'REVOKED')`),
    check('whatsapp_consent_events_source_chk', sql`${table.source} IN ('WEB', 'WHATSAPP', 'ADMIN')`),
  ],
);

export const whatsappInboxEvents = pgTable(
  'whatsapp_inbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id, { onDelete: 'restrict' }),
    providerMessageId: varchar('provider_message_id', { length: 160 }).notNull(),
    senderId: varchar('sender_id', { length: 80 }).notNull(),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    messageType: varchar('message_type', { length: 24 }),
    messageText: text('message_text'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
  },
  (table) => [
    unique('whatsapp_inbox_events_connection_message_uq').on(table.connectionId, table.providerMessageId),
    index('whatsapp_inbox_events_processing_idx').on(table.processedAt, table.receivedAt),
  ],
);

export type WhatsAppCompanyOption = { companyLinkId: string; companyId: string; name: string };

export const whatsappRequests = pgTable('whatsapp_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  linkId: uuid('link_id').notNull().references(() => whatsappLinks.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  sourceInboxEventId: uuid('source_inbox_event_id').notNull().references(() => whatsappInboxEvents.id, { onDelete: 'restrict' }),
  companyLinkId: uuid('company_link_id'),
  companyId: uuid('company_id'),
  messageText: text('message_text').notNull(),
  selectionCode: varchar('selection_code', { length: 16 }).notNull(),
  options: jsonb('options').$type<WhatsAppCompanyOption[]>().notNull(),
  conversation: jsonb('conversation').$type<unknown[]>().default([]).notNull(),
  status: varchar('status', { length: 24 }).default('AWAITING_COMPANY').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  selectedAt: timestamp('selected_at', { withTimezone: true }),
  ...timestamps,
}, (table) => [
  unique('whatsapp_requests_source_event_uq').on(table.sourceInboxEventId),
  unique('whatsapp_requests_selection_code_uq').on(table.selectionCode),
  index('whatsapp_requests_link_state_idx').on(table.linkId, table.status, table.createdAt),
  foreignKey({ name: 'whatsapp_requests_company_context_fk', columns: [table.companyLinkId, table.linkId, table.companyId, table.userId], foreignColumns: [whatsappLinkCompanies.id, whatsappLinkCompanies.linkId, whatsappLinkCompanies.companyId, whatsappLinkCompanies.userId] }).onDelete('restrict'),
  check('whatsapp_requests_context_chk', sql`(${table.companyLinkId} IS NULL) = (${table.companyId} IS NULL)`),
  check('whatsapp_requests_status_chk', sql`${table.status} IN ('AWAITING_COMPANY', 'AWAITING_REPLY', 'READY', 'PROCESSING', 'COMPLETED', 'CANCELED', 'EXPIRED', 'FAILED')`),
  check('whatsapp_requests_selected_chk', sql`${table.status} NOT IN ('AWAITING_REPLY', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED') OR ${table.companyLinkId} IS NOT NULL`),
]);

export const integrationOutbox = pgTable(
  'integration_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topic: varchar('topic', { length: 80 }).notNull(),
    aggregateId: uuid('aggregate_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    state: varchar('state', { length: 16 }).default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('integration_outbox_dispatch_idx').on(table.state, table.availableAt, table.createdAt),
    check('integration_outbox_state_chk', sql`${table.state} IN ('PENDING', 'PUBLISHED', 'COMPLETED', 'FAILED')`),
    check('integration_outbox_attempts_chk', sql`${table.attempts} >= 0`),
  ],
);

export const whatsappOutboundMessages = pgTable(
  'whatsapp_outbound_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id, { onDelete: 'restrict' }),
    linkId: uuid('link_id').references(() => whatsappLinks.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    companyLinkId: uuid('company_link_id').references(() => whatsappLinkCompanies.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id').references(() => whatsappRequests.id, { onDelete: 'restrict' }),
    recipientId: varchar('recipient_id', { length: 80 }).notNull(),
    messageType: varchar('message_type', { length: 24 }).default('TEXT').notNull(),
    body: text('body').notNull(),
    logicalKey: varchar('logical_key', { length: 160 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 160 }),
    status: varchar('status', { length: 20 }).default('QUEUED').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    ...timestamps,
  },
  (table) => [
    unique('whatsapp_outbound_messages_logical_key_uq').on(table.logicalKey),
    uniqueIndex('whatsapp_outbound_messages_provider_id_uq').on(table.connectionId, table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    index('whatsapp_outbound_messages_link_date_idx').on(table.linkId, table.createdAt),
    check('whatsapp_outbound_messages_type_chk', sql`${table.messageType} IN ('TEXT', 'TEMPLATE', 'DOCUMENT')`),
    check('whatsapp_outbound_messages_status_chk', sql`${table.status} IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED')`),
    check('whatsapp_outbound_messages_body_chk', sql`length(btrim(${table.body})) > 0`),
  ],
);

export const whatsappSendAttempts = pgTable(
  'whatsapp_send_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    outboundMessageId: uuid('outbound_message_id').notNull().references(() => whatsappOutboundMessages.id, { onDelete: 'restrict' }),
    attempt: integer('attempt').notNull(),
    httpStatus: integer('http_status'),
    providerErrorCode: varchar('provider_error_code', { length: 80 }),
    errorMessage: text('error_message'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('whatsapp_send_attempts_message_attempt_uq').on(table.outboundMessageId, table.attempt),
    check('whatsapp_send_attempts_attempt_chk', sql`${table.attempt} > 0`),
  ],
);

export const whatsappStatusEvents = pgTable(
  'whatsapp_status_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id').notNull().references(() => whatsappConnections.id, { onDelete: 'restrict' }),
    providerMessageId: varchar('provider_message_id', { length: 160 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('whatsapp_status_events_message_status_date_uq').on(table.connectionId, table.providerMessageId, table.status, table.occurredAt),
    index('whatsapp_status_events_message_idx').on(table.connectionId, table.providerMessageId),
  ],
);

export const assistantRuns = pgTable(
  'assistant_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    inboxEventId: uuid('inbox_event_id').notNull().references(() => whatsappInboxEvents.id, { onDelete: 'restrict' }),
    linkId: uuid('link_id').notNull().references(() => whatsappLinks.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    companyLinkId: uuid('company_link_id').references(() => whatsappLinkCompanies.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id').references(() => whatsappRequests.id, { onDelete: 'restrict' }),
    provider: varchar('provider', { length: 24 }).default('OPENAI').notNull(),
    model: varchar('model', { length: 80 }).notNull(),
    status: varchar('status', { length: 20 }).default('RUNNING').notNull(),
    toolCallCount: integer('tool_call_count').default(0).notNull(),
    responseText: text('response_text'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    unique('assistant_runs_inbox_event_uq').on(table.inboxEventId),
    index('assistant_runs_company_date_idx').on(table.companyId, table.startedAt),
    foreignKey({
      name: 'assistant_runs_company_user_fk',
      columns: [table.companyId, table.userId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('assistant_runs_status_chk', sql`${table.status} IN ('RUNNING', 'COMPLETED', 'FAILED')`),
    check('assistant_runs_tokens_chk', sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)`),
  ],
);

export const assistantActions = pgTable(
  'assistant_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assistantRunId: uuid('assistant_run_id').notNull().references(() => assistantRuns.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    toolName: varchar('tool_name', { length: 80 }).notNull(),
    riskLevel: varchar('risk_level', { length: 16 }).default('READ').notNull(),
    status: varchar('status', { length: 20 }).default('REQUESTED').notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    confirmationTokenHash: char('confirmation_token_hash', { length: 64 }),
    confirmationExpiresAt: timestamp('confirmation_expires_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('assistant_actions_run_idx').on(table.assistantRunId, table.createdAt),
    index('assistant_actions_confirmation_idx').on(table.confirmationTokenHash, table.confirmationExpiresAt),
    foreignKey({
      name: 'assistant_actions_company_user_fk',
      columns: [table.companyId, table.userId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('assistant_actions_risk_chk', sql`${table.riskLevel} IN ('READ', 'WRITE', 'SENSITIVE')`),
    check('assistant_actions_status_chk', sql`${table.status} IN ('REQUESTED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'EXECUTED', 'REJECTED', 'FAILED')`),
  ],
);
