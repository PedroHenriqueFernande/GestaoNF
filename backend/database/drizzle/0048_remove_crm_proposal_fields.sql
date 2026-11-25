ALTER TABLE "crm_proposals" DROP CONSTRAINT "crm_proposals_identity_chk";--> statement-breakpoint
DROP INDEX "crm_proposals_expiry_idx";--> statement-breakpoint
ALTER TABLE "crm_proposals" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "crm_proposals" DROP COLUMN "commercial_description";--> statement-breakpoint
ALTER TABLE "crm_proposals" DROP COLUMN "payment_terms";--> statement-breakpoint
ALTER TABLE "crm_proposals" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "crm_proposals" DROP COLUMN "terms";--> statement-breakpoint
ALTER TABLE "crm_proposals" DROP COLUMN "valid_until";--> statement-breakpoint
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_identity_chk" CHECK ("crm_proposals"."proposal_number" > 0 AND "crm_proposals"."version" > 0 AND length(btrim("crm_proposals"."recipient_name")) > 0);