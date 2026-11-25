ALTER TABLE "crm_meetings" DROP CONSTRAINT "crm_meetings_title_chk";--> statement-breakpoint
ALTER TABLE "crm_meetings" DROP CONSTRAINT "crm_meetings_modality_chk";--> statement-breakpoint
ALTER TABLE "crm_meetings" DROP CONSTRAINT "crm_meetings_text_chk";--> statement-breakpoint
ALTER TABLE "crm_meetings" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "crm_meetings" DROP COLUMN "modality";--> statement-breakpoint
ALTER TABLE "crm_meetings" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "crm_meetings" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_text_chk" CHECK (("crm_meetings"."outcome_notes" IS NULL OR length("crm_meetings"."outcome_notes") <= 10000) AND ("crm_meetings"."next_steps" IS NULL OR length("crm_meetings"."next_steps") <= 10000));