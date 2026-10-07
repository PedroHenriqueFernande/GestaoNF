CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_name_nonblank_chk" CHECK (length(btrim("companies"."name")) > 0),
	CONSTRAINT "companies_status_chk" CHECK ("companies"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "company_users" (
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_users_pk" PRIMARY KEY("company_id","user_id"),
	CONSTRAINT "company_users_role_chk" CHECK ("company_users"."role" IN ('OWNER', 'ADMIN', 'MANAGER', 'COLLABORATOR')),
	CONSTRAINT "company_users_status_chk" CHECK ("company_users"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" varchar(2) NOT NULL,
	"name" varchar(200) NOT NULL,
	"trade_name" varchar(200),
	"tax_id" varchar(14),
	"email" varchar(254),
	"phone" varchar(32),
	"notes" text,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"street" varchar(200),
	"number" varchar(30),
	"complement" varchar(100),
	"district" varchar(120),
	"postal_code" varchar(8),
	"city_name" varchar(150),
	"city_ibge_code" varchar(7),
	"state_code" varchar(2),
	"country_code" varchar(2) DEFAULT 'BR' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "customers_kind_chk" CHECK ("customers"."kind" IN ('PF', 'PJ')),
	CONSTRAINT "customers_name_nonblank_chk" CHECK (length(btrim("customers"."name")) > 0),
	CONSTRAINT "customers_trade_name_kind_chk" CHECK ("customers"."kind" = 'PJ' OR "customers"."trade_name" IS NULL),
	CONSTRAINT "customers_status_chk" CHECK ("customers"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "customers_tax_id_shape_chk" CHECK ("customers"."tax_id" IS NULL OR ("customers"."kind" = 'PF' AND "customers"."tax_id" ~ '^[0-9]{11}$') OR ("customers"."kind" = 'PJ' AND "customers"."tax_id" ~ '^[A-Z0-9]{12}[0-9]{2}$')),
	CONSTRAINT "customers_postal_code_chk" CHECK ("customers"."postal_code" IS NULL OR "customers"."postal_code" ~ '^[0-9]{8}$'),
	CONSTRAINT "customers_city_ibge_code_chk" CHECK ("customers"."city_ibge_code" IS NULL OR "customers"."city_ibge_code" ~ '^[0-9]{7}$'),
	CONSTRAINT "customers_state_code_chk" CHECK ("customers"."state_code" IS NULL OR "customers"."state_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "customers_country_code_chk" CHECK ("customers"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(254) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_name_nonblank_chk" CHECK (length(btrim("users"."name")) > 0),
	CONSTRAINT "users_email_normalized_chk" CHECK ("users"."email" = lower(btrim("users"."email"))),
	CONSTRAINT "users_status_chk" CHECK ("users"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_company_user_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_users_user_id_idx" ON "company_users" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_tax_id_uq" ON "customers" USING btree ("company_id","tax_id") WHERE "customers"."tax_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customers_company_name_id_idx" ON "customers" USING btree ("company_id","name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));