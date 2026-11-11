ALTER TABLE "whatsapp_inbox_events" ADD COLUMN "transcription_status" varchar(16);--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_events" ADD COLUMN "media_seconds" integer;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_events" ADD COLUMN "transcribed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "whatsapp_inbox_events_sender_transcribed_idx" ON "whatsapp_inbox_events" USING btree ("connection_id","sender_id","transcribed_at");--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_events" ADD CONSTRAINT "whatsapp_inbox_events_transcription_chk" CHECK ("whatsapp_inbox_events"."transcription_status" IS NULL OR "whatsapp_inbox_events"."transcription_status" IN ('DONE', 'REJECTED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_events" ADD CONSTRAINT "whatsapp_inbox_events_media_seconds_chk" CHECK ("whatsapp_inbox_events"."media_seconds" IS NULL OR "whatsapp_inbox_events"."media_seconds" >= 0);