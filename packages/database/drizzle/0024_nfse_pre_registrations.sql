ALTER TABLE "companies" DROP CONSTRAINT "companies_special_tax_regime_chk";--> statement-breakpoint
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_description_chk";--> statement-breakpoint
ALTER TABLE "services" DROP CONSTRAINT "services_description_chk";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "simples_ibs_cbs_regime" varchar(1);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "caepf_code" varchar(14);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "municipal_registration" varchar(15);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "caepf_code" varchar(14);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "foreign_tax_id" varchar(40);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "no_foreign_tax_id_reason" varchar(1);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "foreign_postal_code" varchar(11);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "foreign_state_province" varchar(60);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "simples_activity_code" varchar(2);--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_simples_ibs_cbs_chk" CHECK ("companies"."simples_ibs_cbs_regime" IS NULL OR "companies"."simples_ibs_cbs_regime" IN ('1','2','3'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_caepf_chk" CHECK ("companies"."caepf_code" IS NULL OR ("companies"."kind" = 'PF' AND "companies"."caepf_code" ~ '^[0-9]{14}$'));--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_special_tax_regime_chk" CHECK ("companies"."special_tax_regime" IS NULL OR "companies"."special_tax_regime" IN ('0','1','2','3','4','5','6','9'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_caepf_chk" CHECK ("customers"."caepf_code" IS NULL OR ("customers"."kind" = 'PF' AND "customers"."caepf_code" ~ '^[0-9]{14}$'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_no_foreign_tax_id_reason_chk" CHECK ("customers"."no_foreign_tax_id_reason" IS NULL OR "customers"."no_foreign_tax_id_reason" IN ('1','2'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_foreign_identity_chk" CHECK ("customers"."foreign_tax_id" IS NULL OR ("customers"."no_foreign_tax_id_reason" IS NULL AND length(btrim("customers"."foreign_tax_id")) > 0));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_fiscal_text_chk" CHECK (("customers"."municipal_registration" IS NULL OR length(btrim("customers"."municipal_registration")) > 0) AND ("customers"."foreign_postal_code" IS NULL OR length(btrim("customers"."foreign_postal_code")) > 0) AND ("customers"."foreign_state_province" IS NULL OR length(btrim("customers"."foreign_state_province")) > 0));--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_description_chk" CHECK ("sale_items"."description_snapshot" IS NULL OR char_length("sale_items"."description_snapshot") <= 2000);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_simples_activity_chk" CHECK ("services"."simples_activity_code" IS NULL OR "services"."simples_activity_code" IN ('07','08','09','10','11','12','13','14','90'));--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_description_chk" CHECK ("services"."description" IS NULL OR char_length("services"."description") <= 2000);