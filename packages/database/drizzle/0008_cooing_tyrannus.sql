ALTER TABLE "sale_installments" DROP CONSTRAINT "sale_installments_kind_chk";--> statement-breakpoint
DROP INDEX "sale_installments_one_entry_uq";--> statement-breakpoint
ALTER TABLE "sale_installments" DROP COLUMN "kind";