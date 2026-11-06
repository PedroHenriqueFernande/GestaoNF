CREATE TABLE "receivable_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"receivable_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"effective_on" date NOT NULL,
	"payment_method" varchar(24),
	"reference" varchar(100),
	"reverses_movement_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"idempotency_key" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivable_movements_company_receivable_id_uq" UNIQUE("company_id","receivable_id","id"),
	CONSTRAINT "receivable_movements_amount_chk" CHECK ("receivable_movements"."amount" > 0),
	CONSTRAINT "receivable_movements_kind_chk" CHECK (("receivable_movements"."kind" = 'RECEIPT' AND "receivable_movements"."reverses_movement_id" IS NULL AND "receivable_movements"."payment_method" IS NOT NULL AND "receivable_movements"."payment_method" IN ('PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER')) OR ("receivable_movements"."kind" = 'REVERSAL' AND "receivable_movements"."reverses_movement_id" IS NOT NULL AND "receivable_movements"."payment_method" IS NULL)),
	CONSTRAINT "receivable_movements_not_self_reversal_chk" CHECK ("receivable_movements"."reverses_movement_id" IS NULL OR "receivable_movements"."reverses_movement_id" <> "receivable_movements"."id"),
	CONSTRAINT "receivable_movements_reference_chk" CHECK ("receivable_movements"."reference" IS NULL OR length(btrim("receivable_movements"."reference")) > 0)
);
--> statement-breakpoint
CREATE TABLE "receivables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_installment_id" uuid NOT NULL,
	"original_amount" numeric(15, 2) NOT NULL,
	"due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receivables_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "receivables_company_installment_uq" UNIQUE("company_id","sale_installment_id"),
	CONSTRAINT "receivables_amount_chk" CHECK ("receivables"."original_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"control_code" char(4),
	"kind" varchar(16) DEFAULT 'REGULAR' NOT NULL,
	"payment_method" varchar(24) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"due_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_installments_company_sale_id_uq" UNIQUE("company_id","sale_id","id"),
	CONSTRAINT "sale_installments_company_sale_number_uq" UNIQUE("company_id","sale_id","number"),
	CONSTRAINT "sale_installments_number_chk" CHECK ("sale_installments"."number" > 0),
	CONSTRAINT "sale_installments_code_chk" CHECK ("sale_installments"."control_code" IS NULL OR "sale_installments"."control_code" ~ '^[0-9]{4}$'),
	CONSTRAINT "sale_installments_kind_chk" CHECK ("sale_installments"."kind" IN ('ENTRY', 'REGULAR')),
	CONSTRAINT "sale_installments_method_chk" CHECK ("sale_installments"."payment_method" IN ('PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER')),
	CONSTRAINT "sale_installments_amount_chk" CHECK ("sale_installments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"service_name_snapshot" varchar(200) NOT NULL,
	"description_snapshot" text,
	"unit_label_snapshot" varchar(16) NOT NULL,
	"national_tax_code_snapshot" varchar(6),
	"nbs_code_snapshot" varchar(9),
	"quantity" numeric(15, 4) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"gross_amount" numeric(15, 2) NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"performed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_items_company_sale_position_uq" UNIQUE("company_id","sale_id","position"),
	CONSTRAINT "sale_items_position_chk" CHECK ("sale_items"."position" > 0),
	CONSTRAINT "sale_items_name_chk" CHECK (length(btrim("sale_items"."service_name_snapshot")) > 0),
	CONSTRAINT "sale_items_unit_chk" CHECK (length(btrim("sale_items"."unit_label_snapshot")) > 0),
	CONSTRAINT "sale_items_description_chk" CHECK ("sale_items"."description_snapshot" IS NULL OR char_length("sale_items"."description_snapshot") <= 1000),
	CONSTRAINT "sale_items_national_tax_code_chk" CHECK ("sale_items"."national_tax_code_snapshot" IS NULL OR "sale_items"."national_tax_code_snapshot" ~ '^[0-9]{6}$'),
	CONSTRAINT "sale_items_nbs_code_chk" CHECK ("sale_items"."nbs_code_snapshot" IS NULL OR "sale_items"."nbs_code_snapshot" ~ '^[0-9]{9}$'),
	CONSTRAINT "sale_items_amounts_chk" CHECK ("sale_items"."quantity" > 0 AND "sale_items"."unit_price" >= 0 AND "sale_items"."gross_amount" = round("sale_items"."quantity" * "sale_items"."unit_price", 2) AND "sale_items"."discount_amount" >= 0 AND "sale_items"."discount_amount" <= "sale_items"."gross_amount" AND "sale_items"."total_amount" = "sale_items"."gross_amount" - "sale_items"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "sale_reference_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"old_work_order_number" varchar(40),
	"new_work_order_number" varchar(40),
	"actor_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_reference_history_changed_chk" CHECK ("sale_reference_history"."old_work_order_number" IS DISTINCT FROM "sale_reference_history"."new_work_order_number"),
	CONSTRAINT "sale_reference_history_old_chk" CHECK ("sale_reference_history"."old_work_order_number" IS NULL OR length(btrim("sale_reference_history"."old_work_order_number")) > 0),
	CONSTRAINT "sale_reference_history_new_chk" CHECK ("sale_reference_history"."new_work_order_number" IS NULL OR length(btrim("sale_reference_history"."new_work_order_number")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"from_status" varchar(16),
	"to_status" varchar(16) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_status_history_from_chk" CHECK ("sale_status_history"."from_status" IS NULL OR "sale_status_history"."from_status" IN ('DRAFT', 'CONFIRMED', 'CANCELED')),
	CONSTRAINT "sale_status_history_to_chk" CHECK ("sale_status_history"."to_status" IN ('DRAFT', 'CONFIRMED', 'CANCELED')),
	CONSTRAINT "sale_status_history_transition_chk" CHECK ("sale_status_history"."from_status" IS DISTINCT FROM "sale_status_history"."to_status" AND ("sale_status_history"."from_status" IS NOT NULL OR "sale_status_history"."to_status" = 'DRAFT')),
	CONSTRAINT "sale_status_history_reason_chk" CHECK (("sale_status_history"."to_status" <> 'CANCELED' OR ("sale_status_history"."reason" IS NOT NULL AND length(btrim("sale_status_history"."reason")) > 0)) AND ("sale_status_history"."reason" IS NULL OR length(btrim("sale_status_history"."reason")) > 0))
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_code" char(5) NOT NULL,
	"work_order_number" varchar(40),
	"customer_id" uuid NOT NULL,
	"customer_kind_snapshot" varchar(2) NOT NULL,
	"customer_name_snapshot" varchar(200) NOT NULL,
	"customer_tax_id_snapshot" varchar(14),
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"sold_on" date,
	"subtotal_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "sales_company_order_code_uq" UNIQUE("company_id","order_code"),
	CONSTRAINT "sales_company_idempotency_key_uq" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "sales_order_code_chk" CHECK ("sales"."order_code" ~ '^[0-9]{5}$'),
	CONSTRAINT "sales_work_order_number_chk" CHECK ("sales"."work_order_number" IS NULL OR length(btrim("sales"."work_order_number")) > 0),
	CONSTRAINT "sales_customer_kind_snapshot_chk" CHECK ("sales"."customer_kind_snapshot" IN ('PF', 'PJ')),
	CONSTRAINT "sales_customer_name_snapshot_chk" CHECK (length(btrim("sales"."customer_name_snapshot")) > 0),
	CONSTRAINT "sales_customer_tax_id_snapshot_chk" CHECK ("sales"."customer_tax_id_snapshot" IS NULL OR ("sales"."customer_kind_snapshot" = 'PF' AND "sales"."customer_tax_id_snapshot" ~ '^[0-9]{11}$') OR ("sales"."customer_kind_snapshot" = 'PJ' AND "sales"."customer_tax_id_snapshot" ~ '^[A-Z0-9]{12}[0-9]{2}$')),
	CONSTRAINT "sales_status_chk" CHECK ("sales"."status" IN ('DRAFT', 'CONFIRMED', 'CANCELED')),
	CONSTRAINT "sales_amounts_chk" CHECK ("sales"."subtotal_amount" >= 0 AND "sales"."discount_amount" >= 0 AND "sales"."discount_amount" <= "sales"."subtotal_amount" AND "sales"."total_amount" = "sales"."subtotal_amount" - "sales"."discount_amount"),
	CONSTRAINT "sales_version_chk" CHECK ("sales"."version" > 0),
	CONSTRAINT "sales_confirmed_chk" CHECK ("sales"."status" <> 'CONFIRMED' OR ("sales"."sold_on" IS NOT NULL AND "sales"."confirmed_at" IS NOT NULL AND "sales"."total_amount" > 0)),
	CONSTRAINT "sales_canceled_chk" CHECK (("sales"."status" = 'CANCELED') = ("sales"."canceled_at" IS NOT NULL)),
	CONSTRAINT "sales_request_hash_chk" CHECK ("sales"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "receivable_movements" ADD CONSTRAINT "receivable_movements_receivable_company_fk" FOREIGN KEY ("company_id","receivable_id") REFERENCES "public"."receivables"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_movements" ADD CONSTRAINT "receivable_movements_reversal_same_receivable_fk" FOREIGN KEY ("company_id","receivable_id","reverses_movement_id") REFERENCES "public"."receivable_movements"("company_id","receivable_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivable_movements" ADD CONSTRAINT "receivable_movements_created_by_company_user_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_installment_company_sale_fk" FOREIGN KEY ("company_id","sale_id","sale_installment_id") REFERENCES "public"."sale_installments"("company_id","sale_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_installments" ADD CONSTRAINT "sale_installments_sale_company_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_company_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_service_company_fk" FOREIGN KEY ("company_id","service_id") REFERENCES "public"."services"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_reference_history" ADD CONSTRAINT "sale_reference_history_sale_company_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_reference_history" ADD CONSTRAINT "sale_reference_history_actor_company_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_status_history" ADD CONSTRAINT "sale_status_history_sale_company_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_status_history" ADD CONSTRAINT "sale_status_history_actor_company_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_company_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_company_user_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_movements_company_idempotency_key_uq" ON "receivable_movements" USING btree ("company_id","idempotency_key") WHERE "receivable_movements"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "receivable_movements_one_reversal_uq" ON "receivable_movements" USING btree ("company_id","reverses_movement_id") WHERE "receivable_movements"."reverses_movement_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "receivable_movements_company_receivable_recorded_idx" ON "receivable_movements" USING btree ("company_id","receivable_id","recorded_at");--> statement-breakpoint
CREATE INDEX "receivables_company_due_on_idx" ON "receivables" USING btree ("company_id","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_installments_company_sale_code_uq" ON "sale_installments" USING btree ("company_id","sale_id","control_code") WHERE "sale_installments"."control_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_installments_one_entry_uq" ON "sale_installments" USING btree ("company_id","sale_id") WHERE "sale_installments"."kind" = 'ENTRY';--> statement-breakpoint
CREATE INDEX "sale_installments_company_due_on_idx" ON "sale_installments" USING btree ("company_id","due_on");--> statement-breakpoint
CREATE INDEX "sale_reference_history_company_sale_occurred_idx" ON "sale_reference_history" USING btree ("company_id","sale_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sale_status_history_company_sale_occurred_idx" ON "sale_status_history" USING btree ("company_id","sale_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sales_company_status_date_id_idx" ON "sales" USING btree ("company_id","status","sold_on" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "sales_company_customer_date_id_idx" ON "sales" USING btree ("company_id","customer_id","sold_on" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "sales_company_work_order_number_idx" ON "sales" USING btree ("company_id","work_order_number") WHERE "sales"."work_order_number" IS NOT NULL;