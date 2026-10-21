CREATE TABLE "nfse_dps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"environment" varchar(16) NOT NULL,
	"issuer_tax_id_snapshot" varchar(14) NOT NULL,
	"municipality_ibge_code" varchar(7) NOT NULL,
	"series_number" integer NOT NULL,
	"dps_number" bigint NOT NULL,
	"source_sale_id" uuid,
	"status" varchar(16) DEFAULT 'RESERVED' NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_dps_identity_uq" UNIQUE("environment","issuer_tax_id_snapshot","municipality_ibge_code","series_number","dps_number"),
	CONSTRAINT "nfse_dps_request_key_uq" UNIQUE("company_id","request_key"),
	CONSTRAINT "nfse_dps_status_chk" CHECK ("nfse_dps"."status" IN ('RESERVED','READY','SENDING','UNKNOWN','REJECTED','AUTHORIZED')),
	CONSTRAINT "nfse_dps_request_hash_chk" CHECK ("nfse_dps"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "nfse_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" varchar(16) DEFAULT 'NATIONAL' NOT NULL,
	"environment" varchar(16) NOT NULL,
	"issuer_tax_id_snapshot" varchar(14) NOT NULL,
	"municipality_ibge_code" varchar(7) NOT NULL,
	"series_number" integer NOT NULL,
	"initial_number" bigint NOT NULL,
	"next_number" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_series_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_series_identity_uq" UNIQUE("provider","environment","issuer_tax_id_snapshot","municipality_ibge_code","series_number"),
	CONSTRAINT "nfse_series_environment_chk" CHECK ("nfse_series"."environment" IN ('HOMOLOGATION','PRODUCTION')),
	CONSTRAINT "nfse_series_provider_chk" CHECK ("nfse_series"."provider" = 'NATIONAL'),
	CONSTRAINT "nfse_series_status_chk" CHECK ("nfse_series"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "nfse_series_city_chk" CHECK ("nfse_series"."municipality_ibge_code" ~ '^[0-9]{7}$'),
	CONSTRAINT "nfse_series_tax_id_chk" CHECK ("nfse_series"."issuer_tax_id_snapshot" ~ '^[0-9]{11}$' OR "nfse_series"."issuer_tax_id_snapshot" ~ '^[A-Z0-9]{12}[0-9]{2}$'),
	CONSTRAINT "nfse_series_number_chk" CHECK ("nfse_series"."series_number" BETWEEN 1 AND 49999),
	CONSTRAINT "nfse_series_next_chk" CHECK ("nfse_series"."initial_number" BETWEEN 1 AND 999999999999999 AND "nfse_series"."next_number" BETWEEN "nfse_series"."initial_number" AND 1000000000000000)
);
--> statement-breakpoint
CREATE TABLE "nfse_series_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"old_next_number" bigint NOT NULL,
	"new_next_number" bigint NOT NULL,
	"reason" varchar(500) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_series_adjustments_forward_chk" CHECK ("nfse_series_adjustments"."new_next_number" > "nfse_series_adjustments"."old_next_number")
);
--> statement-breakpoint
CREATE TABLE "nfse_tax_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"effective_from" date NOT NULL,
	"iss_rate_percent" numeric(7, 4),
	"pis_rate_percent" numeric(7, 4),
	"cofins_rate_percent" numeric(7, 4),
	"csll_rate_percent" numeric(7, 4),
	"ir_rate_percent" numeric(7, 4),
	"inss_rate_percent" numeric(7, 4),
	"iss_withholding_suggestion" boolean,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_tax_revisions_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_tax_revisions_profile_revision_uq" UNIQUE("profile_id","revision"),
	CONSTRAINT "nfse_tax_revisions_profile_date_uq" UNIQUE("profile_id","effective_from"),
	CONSTRAINT "nfse_tax_revisions_revision_chk" CHECK ("nfse_tax_profile_revisions"."revision" > 0),
	CONSTRAINT "nfse_tax_revisions_iss_chk" CHECK ("nfse_tax_profile_revisions"."iss_rate_percent" IS NULL OR "nfse_tax_profile_revisions"."iss_rate_percent" BETWEEN 0 AND 5),
	CONSTRAINT "nfse_tax_revisions_rates_chk" CHECK (("nfse_tax_profile_revisions"."pis_rate_percent" IS NULL OR "nfse_tax_profile_revisions"."pis_rate_percent" BETWEEN 0 AND 100) AND ("nfse_tax_profile_revisions"."cofins_rate_percent" IS NULL OR "nfse_tax_profile_revisions"."cofins_rate_percent" BETWEEN 0 AND 100) AND ("nfse_tax_profile_revisions"."csll_rate_percent" IS NULL OR "nfse_tax_profile_revisions"."csll_rate_percent" BETWEEN 0 AND 100) AND ("nfse_tax_profile_revisions"."ir_rate_percent" IS NULL OR "nfse_tax_profile_revisions"."ir_rate_percent" BETWEEN 0 AND 100) AND ("nfse_tax_profile_revisions"."inss_rate_percent" IS NULL OR "nfse_tax_profile_revisions"."inss_rate_percent" BETWEEN 0 AND 100))
);
--> statement-breakpoint
CREATE TABLE "nfse_tax_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"scope" varchar(24) NOT NULL,
	"service_id" uuid,
	"municipality_ibge_code" varchar(7),
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_tax_profiles_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_tax_profiles_scope_chk" CHECK (("nfse_tax_profiles"."scope" = 'COMPANY' AND "nfse_tax_profiles"."service_id" IS NULL AND "nfse_tax_profiles"."municipality_ibge_code" IS NULL) OR ("nfse_tax_profiles"."scope" = 'SERVICE' AND "nfse_tax_profiles"."service_id" IS NOT NULL AND "nfse_tax_profiles"."municipality_ibge_code" IS NULL) OR ("nfse_tax_profiles"."scope" = 'SERVICE_MUNICIPALITY' AND "nfse_tax_profiles"."service_id" IS NOT NULL AND "nfse_tax_profiles"."municipality_ibge_code" ~ '^[0-9]{7}$')),
	CONSTRAINT "nfse_tax_profiles_status_chk" CHECK ("nfse_tax_profiles"."status" IN ('ACTIVE','INACTIVE')),
	CONSTRAINT "nfse_tax_profiles_name_chk" CHECK (length(btrim("nfse_tax_profiles"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "tax_profile_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "tax_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "fiscal_series_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_series_fk" FOREIGN KEY ("company_id","series_id") REFERENCES "public"."nfse_series"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_sale_fk" FOREIGN KEY ("company_id","source_sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_series" ADD CONSTRAINT "nfse_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_series" ADD CONSTRAINT "nfse_series_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_series_adjustments" ADD CONSTRAINT "nfse_series_adjustments_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_series_adjustments" ADD CONSTRAINT "nfse_series_adjustments_series_fk" FOREIGN KEY ("company_id","series_id") REFERENCES "public"."nfse_series"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_tax_profile_revisions" ADD CONSTRAINT "nfse_tax_profile_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_tax_profile_revisions" ADD CONSTRAINT "nfse_tax_revisions_profile_fk" FOREIGN KEY ("company_id","profile_id") REFERENCES "public"."nfse_tax_profiles"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_tax_profiles" ADD CONSTRAINT "nfse_tax_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_tax_profiles" ADD CONSTRAINT "nfse_tax_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_tax_profiles" ADD CONSTRAINT "nfse_tax_profiles_service_fk" FOREIGN KEY ("company_id","service_id") REFERENCES "public"."services"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_series_default_uq" ON "nfse_series" USING btree ("company_id","environment","issuer_tax_id_snapshot","municipality_ibge_code") WHERE "nfse_series"."is_default" AND "nfse_series"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "nfse_series_company_environment_idx" ON "nfse_series" USING btree ("company_id","environment","status");--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_tax_profiles_default_company_uq" ON "nfse_tax_profiles" USING btree ("company_id") WHERE "nfse_tax_profiles"."status" = 'ACTIVE' AND "nfse_tax_profiles"."is_default" AND "nfse_tax_profiles"."scope" = 'COMPANY';--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_tax_profiles_default_service_uq" ON "nfse_tax_profiles" USING btree ("company_id","service_id") WHERE "nfse_tax_profiles"."status" = 'ACTIVE' AND "nfse_tax_profiles"."is_default" AND "nfse_tax_profiles"."scope" = 'SERVICE';--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_tax_profiles_default_city_uq" ON "nfse_tax_profiles" USING btree ("company_id","service_id","municipality_ibge_code") WHERE "nfse_tax_profiles"."status" = 'ACTIVE' AND "nfse_tax_profiles"."is_default" AND "nfse_tax_profiles"."scope" = 'SERVICE_MUNICIPALITY';--> statement-breakpoint
CREATE INDEX "nfse_tax_profiles_company_scope_idx" ON "nfse_tax_profiles" USING btree ("company_id","scope","status");--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tax_revision_fk" FOREIGN KEY ("company_id","tax_profile_revision_id") REFERENCES "public"."nfse_tax_profile_revisions"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_fiscal_series_fk" FOREIGN KEY ("company_id","fiscal_series_id") REFERENCES "public"."nfse_series"("company_id","id") ON DELETE restrict ON UPDATE no action;