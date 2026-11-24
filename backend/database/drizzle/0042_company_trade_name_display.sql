ALTER TABLE "companies" DROP CONSTRAINT "companies_name_nonblank_chk";--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT "companies_trade_name_kind_chk";--> statement-breakpoint
-- O nome fantasia passa a ser o nome exibido. Onde ele ja existe, prevalece; onde esta vazio, recebe o antigo nome de exibicao.
UPDATE "companies" SET "trade_name" = btrim("name") WHERE "trade_name" IS NULL OR btrim("trade_name") = '';--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "trade_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_trade_name_nonblank_chk" CHECK (length(btrim("companies"."trade_name")) > 0);
