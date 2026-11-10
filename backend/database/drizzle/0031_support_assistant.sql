CREATE TABLE "support_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb NOT NULL,
	"result_entity_id" uuid,
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_actions_kind_chk" CHECK ("support_actions"."kind" IN ('CREATE_CUSTOMER', 'CREATE_SERVICE')),
	CONSTRAINT "support_actions_status_chk" CHECK ("support_actions"."status" IN ('PENDING', 'CONFIRMED', 'CANCELED', 'EXPIRED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_conversations_status_chk" CHECK ("support_conversations"."status" IN ('ACTIVE', 'CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "support_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conversation_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"blocks" jsonb NOT NULL,
	"llm_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(80),
	"input_tokens" integer,
	"output_tokens" integer,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_role_chk" CHECK ("support_messages"."role" IN ('user', 'assistant')),
	CONSTRAINT "support_messages_counts_chk" CHECK (("support_messages"."input_tokens" IS NULL OR "support_messages"."input_tokens" >= 0) AND ("support_messages"."output_tokens" IS NULL OR "support_messages"."output_tokens" >= 0) AND "support_messages"."tool_call_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_message_id_support_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_actions_pending_uq" ON "support_actions" USING btree ("conversation_id") WHERE "support_actions"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "support_actions_company_user_idx" ON "support_actions" USING btree ("company_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_conversations_active_uq" ON "support_conversations" USING btree ("company_id","user_id") WHERE "support_conversations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "support_messages_conversation_idx" ON "support_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE INDEX "support_messages_company_role_idx" ON "support_messages" USING btree ("company_id","role","created_at");