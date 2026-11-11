ALTER TABLE "assistant_actions" ALTER COLUMN "status" SET DATA TYPE varchar(24);--> statement-breakpoint
ALTER TABLE "assistant_actions" ALTER COLUMN "status" SET DEFAULT 'REQUESTED';