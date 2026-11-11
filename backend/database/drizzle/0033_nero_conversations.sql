CREATE TABLE "nero_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"company_link_id" uuid,
	"status" varchar(20) DEFAULT 'AWAITING_COMPANY' NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nero_conversations_status_chk" CHECK ("nero_conversations"."status" IN ('AWAITING_COMPANY', 'ACTIVE', 'CLOSED')),
	CONSTRAINT "nero_conversations_company_chk" CHECK ("nero_conversations"."status" <> 'ACTIVE' OR ("nero_conversations"."company_id" IS NOT NULL AND "nero_conversations"."company_link_id" IS NOT NULL)),
	CONSTRAINT "nero_conversations_closed_chk" CHECK (("nero_conversations"."status" = 'CLOSED') = ("nero_conversations"."closed_at" IS NOT NULL)),
	CONSTRAINT "nero_conversations_reason_chk" CHECK ("nero_conversations"."closed_reason" IS NULL OR "nero_conversations"."closed_reason" IN ('IDLE', 'NEW_TOPIC', 'COMPANY_SWITCH', 'LINK_REVOKED'))
);
--> statement-breakpoint
CREATE TABLE "nero_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(12) NOT NULL,
	"source" varchar(12) DEFAULT 'TEXT' NOT NULL,
	"content" text NOT NULL,
	"inbox_event_id" uuid,
	"outbound_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nero_messages_role_chk" CHECK ("nero_messages"."role" IN ('USER', 'ASSISTANT', 'TOOL')),
	CONSTRAINT "nero_messages_source_chk" CHECK ("nero_messages"."source" IN ('TEXT', 'AUDIO', 'BUTTON', 'SYSTEM')),
	CONSTRAINT "nero_messages_content_chk" CHECK (length(btrim("nero_messages"."content")) > 0)
);
--> statement-breakpoint
ALTER TABLE "assistant_actions" DROP CONSTRAINT "assistant_actions_status_chk";--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" DROP CONSTRAINT "whatsapp_outbound_messages_type_chk";--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD COLUMN "operations" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD COLUMN "summary_text" text;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD COLUMN "summary_hash" char(64);--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD COLUMN "failure" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD COLUMN "interactive" jsonb;--> statement-breakpoint
ALTER TABLE "nero_conversations" ADD CONSTRAINT "nero_conversations_link_id_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_conversations" ADD CONSTRAINT "nero_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_conversations" ADD CONSTRAINT "nero_conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_conversations" ADD CONSTRAINT "nero_conversations_company_link_id_whatsapp_link_companies_id_fk" FOREIGN KEY ("company_link_id") REFERENCES "public"."whatsapp_link_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_conversations" ADD CONSTRAINT "nero_conversations_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_messages" ADD CONSTRAINT "nero_messages_conversation_id_nero_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."nero_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_messages" ADD CONSTRAINT "nero_messages_inbox_event_id_whatsapp_inbox_events_id_fk" FOREIGN KEY ("inbox_event_id") REFERENCES "public"."whatsapp_inbox_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nero_messages" ADD CONSTRAINT "nero_messages_outbound_message_id_whatsapp_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."whatsapp_outbound_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nero_conversations_link_open_uq" ON "nero_conversations" USING btree ("link_id") WHERE "nero_conversations"."status" <> 'CLOSED';--> statement-breakpoint
CREATE INDEX "nero_conversations_link_date_idx" ON "nero_conversations" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE INDEX "nero_messages_conversation_date_idx" ON "nero_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "nero_messages_created_idx" ON "nero_messages" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_conversation_id_nero_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."nero_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_conversation_id_nero_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."nero_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_actions_conversation_status_idx" ON "assistant_actions" USING btree ("conversation_id","status");--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_status_chk" CHECK ("assistant_actions"."status" IN ('REQUESTED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'EXECUTED', 'REJECTED', 'FAILED', 'EXPIRED', 'SUPERSEDED'));--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_type_chk" CHECK ("whatsapp_outbound_messages"."message_type" IN ('TEXT', 'TEMPLATE', 'DOCUMENT', 'INTERACTIVE'));