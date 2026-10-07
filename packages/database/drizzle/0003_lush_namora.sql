ALTER TABLE "companies" ADD COLUMN "kind" varchar(2) DEFAULT 'PJ' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "legal_name" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_id" varchar(14);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" varchar(254);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" varchar(32);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "street" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "number" varchar(30);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "complement" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "district" varchar(120);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "postal_code" varchar(8);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "city_name" varchar(150);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "city_ibge_code" varchar(7);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "state_code" varchar(2);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "country_code" varchar(2) DEFAULT 'BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "municipal_registration" varchar(30);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "state_registration" varchar(30);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "cnae_code" varchar(7);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "simples_national_option" varchar(1);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "simples_taxation_regime" varchar(1);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "special_tax_regime" varchar(1);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "locale" varchar(16) DEFAULT 'pt-BR' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_kind_chk" CHECK ("companies"."kind" IN ('PF', 'PJ'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tax_id_chk" CHECK ("companies"."tax_id" IS NULL OR ("companies"."kind" = 'PF' AND "companies"."tax_id" ~ '^[0-9]{11}$') OR ("companies"."kind" = 'PJ' AND "companies"."tax_id" ~ '^[A-Z0-9]{12}[0-9]{2}$'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_postal_code_chk" CHECK ("companies"."postal_code" IS NULL OR "companies"."postal_code" ~ '^[0-9]{8}$');--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_city_ibge_code_chk" CHECK ("companies"."city_ibge_code" IS NULL OR "companies"."city_ibge_code" ~ '^[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_state_code_chk" CHECK ("companies"."state_code" IS NULL OR "companies"."state_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_country_code_chk" CHECK ("companies"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_cnae_code_chk" CHECK ("companies"."cnae_code" IS NULL OR "companies"."cnae_code" ~ '^[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_simples_option_chk" CHECK ("companies"."simples_national_option" IS NULL OR "companies"."simples_national_option" IN ('1','2','3','4'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_simples_taxation_chk" CHECK ("companies"."simples_taxation_regime" IS NULL OR "companies"."simples_taxation_regime" IN ('1','2','3'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_special_tax_regime_chk" CHECK ("companies"."special_tax_regime" IS NULL OR "companies"."special_tax_regime" IN ('0','1','2','3','4','5','6'));