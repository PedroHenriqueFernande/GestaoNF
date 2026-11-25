ALTER TABLE "customers" DROP CONSTRAINT "customers_caepf_chk";--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_fiscal_text_chk";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "municipal_registration";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "caepf_code";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_fiscal_text_chk" CHECK (("customers"."foreign_postal_code" IS NULL OR length(btrim("customers"."foreign_postal_code")) > 0) AND ("customers"."foreign_state_province" IS NULL OR length(btrim("customers"."foreign_state_province")) > 0));