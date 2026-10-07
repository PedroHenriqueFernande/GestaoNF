CREATE TABLE "service_municipal_tax_codes" (
	"company_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"municipality_ibge_code" varchar(7) NOT NULL,
	"municipal_tax_code" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_municipal_tax_codes_pk" PRIMARY KEY("company_id","service_id","municipality_ibge_code"),
	CONSTRAINT "service_municipal_tax_codes_city_chk" CHECK ("service_municipal_tax_codes"."municipality_ibge_code" ~ '^[0-9]{7}$'),
	CONSTRAINT "service_municipal_tax_codes_code_chk" CHECK ("service_municipal_tax_codes"."municipal_tax_code" ~ '^[0-9]{3}$')
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"internal_code" varchar(20),
	"name" varchar(200) NOT NULL,
	"description" text,
	"unit_label" varchar(16) DEFAULT 'UN' NOT NULL,
	"suggested_unit_price" numeric(15, 2),
	"national_tax_code" varchar(6),
	"nbs_code" varchar(9),
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "services_name_chk" CHECK (length(btrim("services"."name")) > 0),
	CONSTRAINT "services_unit_chk" CHECK (length(btrim("services"."unit_label")) > 0),
	CONSTRAINT "services_internal_code_chk" CHECK ("services"."internal_code" IS NULL OR length(btrim("services"."internal_code")) > 0),
	CONSTRAINT "services_description_chk" CHECK ("services"."description" IS NULL OR char_length("services"."description") <= 1000),
	CONSTRAINT "services_price_chk" CHECK ("services"."suggested_unit_price" IS NULL OR "services"."suggested_unit_price" >= 0),
	CONSTRAINT "services_national_tax_code_chk" CHECK ("services"."national_tax_code" IS NULL OR "services"."national_tax_code" ~ '^[0-9]{6}$'),
	CONSTRAINT "services_nbs_code_chk" CHECK ("services"."nbs_code" IS NULL OR "services"."nbs_code" ~ '^[0-9]{9}$'),
	CONSTRAINT "services_status_chk" CHECK ("services"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "service_municipal_tax_codes" ADD CONSTRAINT "service_municipal_tax_codes_service_fk" FOREIGN KEY ("company_id","service_id") REFERENCES "public"."services"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_company_user_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "services_company_internal_code_uq" ON "services" USING btree ("company_id",lower("internal_code")) WHERE "services"."internal_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "services_company_status_name_id_idx" ON "services" USING btree ("company_id","status","name","id");