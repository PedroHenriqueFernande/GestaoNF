ALTER TABLE "customers" DROP CONSTRAINT "customers_trade_name_kind_chk";--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_tax_id_shape_chk";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "customer_kind_snapshot" DROP NOT NULL;--> statement-breakpoint
UPDATE "customers" SET "kind" = NULL WHERE "tax_id" IS NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_trade_name_kind_chk" CHECK ("customers"."kind" IS NULL OR "customers"."trade_name" IS NULL OR "customers"."kind" = 'PJ');--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tax_id_shape_chk" CHECK (CASE WHEN "customers"."tax_id" IS NULL THEN "customers"."kind" IS NULL ELSE "customers"."kind" IS NOT NULL AND (("customers"."kind" = 'PF' AND "customers"."tax_id" ~ '^[0-9]{11}$') OR ("customers"."kind" = 'PJ' AND "customers"."tax_id" ~ '^[A-Z0-9]{12}[0-9]{2}$')) END);
