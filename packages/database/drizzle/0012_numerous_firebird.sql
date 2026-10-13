CREATE TABLE "assistant_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assistant_run_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tool_name" varchar(80) NOT NULL,
	"risk_level" varchar(16) DEFAULT 'READ' NOT NULL,
	"status" varchar(20) DEFAULT 'REQUESTED' NOT NULL,
	"arguments" jsonb NOT NULL,
	"result" jsonb,
	"confirmation_token_hash" char(64),
	"confirmation_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_actions_risk_chk" CHECK ("assistant_actions"."risk_level" IN ('READ', 'WRITE', 'SENSITIVE')),
	CONSTRAINT "assistant_actions_status_chk" CHECK ("assistant_actions"."status" IN ('REQUESTED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'EXECUTED', 'REJECTED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "assistant_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_event_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(24) DEFAULT 'OPENAI' NOT NULL,
	"model" varchar(80) NOT NULL,
	"status" varchar(20) DEFAULT 'RUNNING' NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"response_text" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_code" varchar(80),
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "assistant_runs_inbox_event_uq" UNIQUE("inbox_event_id"),
	CONSTRAINT "assistant_runs_status_chk" CHECK ("assistant_runs"."status" IN ('RUNNING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "assistant_runs_tokens_chk" CHECK (("assistant_runs"."input_tokens" IS NULL OR "assistant_runs"."input_tokens" >= 0) AND ("assistant_runs"."output_tokens" IS NULL OR "assistant_runs"."output_tokens" >= 0))
);
--> statement-breakpoint
CREATE TABLE "integration_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" varchar(80) NOT NULL,
	"aggregate_id" uuid,
	"payload" jsonb NOT NULL,
	"state" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_outbox_state_chk" CHECK ("integration_outbox"."state" IN ('PENDING', 'PUBLISHED', 'COMPLETED', 'FAILED')),
	CONSTRAINT "integration_outbox_attempts_chk" CHECK ("integration_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownership" varchar(16) DEFAULT 'PLATFORM' NOT NULL,
	"company_id" uuid,
	"environment" varchar(16) DEFAULT 'DEVELOPMENT' NOT NULL,
	"meta_app_id" varchar(80) NOT NULL,
	"business_portfolio_id" varchar(80),
	"messaging_account_id" varchar(80) NOT NULL,
	"phone_number_id" varchar(80) NOT NULL,
	"whatsapp_account_id" varchar(80),
	"display_phone_number" varchar(32) NOT NULL,
	"graph_api_version" varchar(16) DEFAULT 'v23.0' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_connections_environment_phone_uq" UNIQUE("environment","phone_number_id"),
	CONSTRAINT "whatsapp_connections_ownership_chk" CHECK ("whatsapp_connections"."ownership" IN ('PLATFORM', 'COMPANY')),
	CONSTRAINT "whatsapp_connections_environment_chk" CHECK ("whatsapp_connections"."environment" IN ('DEVELOPMENT', 'PRODUCTION')),
	CONSTRAINT "whatsapp_connections_status_chk" CHECK ("whatsapp_connections"."status" IN ('ACTIVE', 'INACTIVE', 'ERROR')),
	CONSTRAINT "whatsapp_connections_owner_chk" CHECK (("whatsapp_connections"."ownership" = 'PLATFORM' AND "whatsapp_connections"."company_id" IS NULL) OR ("whatsapp_connections"."ownership" = 'COMPANY' AND "whatsapp_connections"."company_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"event" varchar(16) NOT NULL,
	"source" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_consent_events_event_chk" CHECK ("whatsapp_consent_events"."event" IN ('GRANTED', 'REVOKED')),
	CONSTRAINT "whatsapp_consent_events_source_chk" CHECK ("whatsapp_consent_events"."source" IN ('WEB', 'WHATSAPP', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_inbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_message_id" varchar(160) NOT NULL,
	"sender_id" varchar(80) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"message_type" varchar(24),
	"message_text" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	CONSTRAINT "whatsapp_inbox_events_connection_message_uq" UNIQUE("connection_id","provider_message_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_link_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"candidate_sender_id" varchar(80),
	"candidate_phone_e164" varchar(20),
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_link_challenges_attempts_chk" CHECK ("whatsapp_link_challenges"."attempts" >= 0),
	CONSTRAINT "whatsapp_link_challenges_status_chk" CHECK ("whatsapp_link_challenges"."status" IN ('PENDING', 'CANDIDATE', 'CONFIRMED', 'EXPIRED', 'CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sender_id" varchar(80) NOT NULL,
	"sender_id_kind" varchar(16) DEFAULT 'WA_ID' NOT NULL,
	"phone_e164" varchar(20),
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_links_sender_kind_chk" CHECK ("whatsapp_links"."sender_id_kind" IN ('WA_ID', 'PHONE')),
	CONSTRAINT "whatsapp_links_status_chk" CHECK ("whatsapp_links"."status" IN ('ACTIVE', 'REVOKED')),
	CONSTRAINT "whatsapp_links_revoked_chk" CHECK (("whatsapp_links"."status" = 'REVOKED') = ("whatsapp_links"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"link_id" uuid,
	"company_id" uuid,
	"recipient_id" varchar(80) NOT NULL,
	"message_type" varchar(24) DEFAULT 'TEXT' NOT NULL,
	"body" text NOT NULL,
	"logical_key" varchar(160) NOT NULL,
	"provider_message_id" varchar(160),
	"status" varchar(20) DEFAULT 'QUEUED' NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_outbound_messages_logical_key_uq" UNIQUE("logical_key"),
	CONSTRAINT "whatsapp_outbound_messages_type_chk" CHECK ("whatsapp_outbound_messages"."message_type" IN ('TEXT', 'TEMPLATE', 'DOCUMENT')),
	CONSTRAINT "whatsapp_outbound_messages_status_chk" CHECK ("whatsapp_outbound_messages"."status" IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
	CONSTRAINT "whatsapp_outbound_messages_body_chk" CHECK (length(btrim("whatsapp_outbound_messages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"http_status" integer,
	"provider_error_code" varchar(80),
	"error_message" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_send_attempts_message_attempt_uq" UNIQUE("outbound_message_id","attempt"),
	CONSTRAINT "whatsapp_send_attempts_attempt_chk" CHECK ("whatsapp_send_attempts"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"active_company_id" uuid NOT NULL,
	"mode" varchar(16) DEFAULT 'NORMAL' NOT NULL,
	"context_version" integer DEFAULT 1 NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_sessions_link_uq" UNIQUE("link_id"),
	CONSTRAINT "whatsapp_sessions_mode_chk" CHECK ("whatsapp_sessions"."mode" IN ('NORMAL', 'AWAITING_CONFIRMATION', 'PAUSED')),
	CONSTRAINT "whatsapp_sessions_context_version_chk" CHECK ("whatsapp_sessions"."context_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "whatsapp_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_message_id" varchar(160) NOT NULL,
	"status" varchar(20) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_status_events_message_status_date_uq" UNIQUE("connection_id","provider_message_id","status","occurred_at")
);
--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_assistant_run_id_assistant_runs_id_fk" FOREIGN KEY ("assistant_run_id") REFERENCES "public"."assistant_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_inbox_event_id_whatsapp_inbox_events_id_fk" FOREIGN KEY ("inbox_event_id") REFERENCES "public"."whatsapp_inbox_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_link_id_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_consent_events" ADD CONSTRAINT "whatsapp_consent_events_link_id_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_consent_events" ADD CONSTRAINT "whatsapp_consent_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_events" ADD CONSTRAINT "whatsapp_inbox_events_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD CONSTRAINT "whatsapp_link_challenges_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD CONSTRAINT "whatsapp_link_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD CONSTRAINT "whatsapp_link_challenges_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_link_id_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_send_attempts" ADD CONSTRAINT "whatsapp_send_attempts_outbound_message_id_whatsapp_outbound_messages_id_fk" FOREIGN KEY ("outbound_message_id") REFERENCES "public"."whatsapp_outbound_messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_link_id_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_active_company_user_fk" FOREIGN KEY ("active_company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_status_events" ADD CONSTRAINT "whatsapp_status_events_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_actions_run_idx" ON "assistant_actions" USING btree ("assistant_run_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_actions_confirmation_idx" ON "assistant_actions" USING btree ("confirmation_token_hash","confirmation_expires_at");--> statement-breakpoint
CREATE INDEX "assistant_runs_company_date_idx" ON "assistant_runs" USING btree ("company_id","started_at");--> statement-breakpoint
CREATE INDEX "integration_outbox_dispatch_idx" ON "integration_outbox" USING btree ("state","available_at","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_connections_company_status_idx" ON "whatsapp_connections" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "whatsapp_consent_events_link_date_idx" ON "whatsapp_consent_events" USING btree ("link_id","occurred_at");--> statement-breakpoint
CREATE INDEX "whatsapp_inbox_events_processing_idx" ON "whatsapp_inbox_events" USING btree ("processed_at","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_link_challenges_token_uq" ON "whatsapp_link_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "whatsapp_link_challenges_user_status_idx" ON "whatsapp_link_challenges" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_links_connection_sender_active_uq" ON "whatsapp_links" USING btree ("connection_id","sender_id") WHERE "whatsapp_links"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_links_connection_user_active_uq" ON "whatsapp_links" USING btree ("connection_id","user_id") WHERE "whatsapp_links"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "whatsapp_links_user_status_idx" ON "whatsapp_links" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_outbound_messages_provider_id_uq" ON "whatsapp_outbound_messages" USING btree ("connection_id","provider_message_id") WHERE "whatsapp_outbound_messages"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_outbound_messages_link_date_idx" ON "whatsapp_outbound_messages" USING btree ("link_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_status_events_message_idx" ON "whatsapp_status_events" USING btree ("connection_id","provider_message_id");