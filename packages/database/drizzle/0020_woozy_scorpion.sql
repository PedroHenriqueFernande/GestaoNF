CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" varchar(200) NOT NULL,
	"provider_email_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"request_key" varchar(200) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"from_address" varchar(320) NOT NULL,
	"to_address" varchar(254) NOT NULL,
	"reply_to" varchar(254),
	"subject" varchar(200) NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text NOT NULL,
	"test_mode" boolean NOT NULL,
	"send_status" varchar(16) DEFAULT 'QUEUED' NOT NULL,
	"delivery_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"provider_email_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"may_have_sent" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_company_request_uq" UNIQUE("company_id","request_key"),
	CONSTRAINT "email_messages_provider_uq" UNIQUE("provider_email_id"),
	CONSTRAINT "email_messages_send_status_chk" CHECK ("email_messages"."send_status" IN ('QUEUED','SENDING','RETRYING','ACCEPTED','FAILED','UNKNOWN')),
	CONSTRAINT "email_messages_delivery_status_chk" CHECK ("email_messages"."delivery_status" IN ('PENDING','SENT','DELAYED','DELIVERED','FAILED','SUPPRESSED','BOUNCED','COMPLAINED')),
	CONSTRAINT "email_messages_attempts_chk" CHECK ("email_messages"."attempts" >= 0),
	CONSTRAINT "email_messages_accepted_chk" CHECK ("email_messages"."send_status" <> 'ACCEPTED' OR ("email_messages"."provider_email_id" IS NOT NULL AND "email_messages"."accepted_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_company_user_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_events_provider_idx" ON "email_events" USING btree ("provider_email_id","occurred_at");--> statement-breakpoint
CREATE INDEX "email_messages_due_idx" ON "email_messages" USING btree ("send_status","available_at");--> statement-breakpoint
CREATE INDEX "email_messages_company_created_idx" ON "email_messages" USING btree ("company_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_messages_last_attempt_idx" ON "email_messages" USING btree ("last_attempt_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_messages_recipient_idx" ON "email_messages" USING btree ("company_id","to_address");