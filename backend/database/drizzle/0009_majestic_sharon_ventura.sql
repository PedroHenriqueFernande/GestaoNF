ALTER TABLE "sale_installments" RENAME COLUMN "control_code" TO "paycode";--> statement-breakpoint
ALTER TABLE "sale_installments" RENAME CONSTRAINT "sale_installments_code_chk" TO "sale_installments_paycode_chk";--> statement-breakpoint
ALTER INDEX "sale_installments_company_sale_code_uq" RENAME TO "sale_installments_company_sale_paycode_uq";
