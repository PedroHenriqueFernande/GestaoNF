CREATE TABLE "whatsapp_link_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_link_companies_context_uq" UNIQUE("id","link_id","company_id","user_id"),
	CONSTRAINT "whatsapp_link_companies_status_chk" CHECK ("whatsapp_link_companies"."status" IN ('ACTIVE', 'REVOKED')),
	CONSTRAINT "whatsapp_link_companies_revoked_chk" CHECK (("whatsapp_link_companies"."status" = 'REVOKED') = ("whatsapp_link_companies"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_inbox_event_id" uuid NOT NULL,
	"company_link_id" uuid,
	"company_id" uuid,
	"message_text" text NOT NULL,
	"selection_code" varchar(16) NOT NULL,
	"options" jsonb NOT NULL,
	"conversation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'AWAITING_COMPANY' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"selected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_requests_source_event_uq" UNIQUE("source_inbox_event_id"),
	CONSTRAINT "whatsapp_requests_selection_code_uq" UNIQUE("selection_code"),
	CONSTRAINT "whatsapp_requests_context_chk" CHECK (("whatsapp_requests"."company_link_id" IS NULL) = ("whatsapp_requests"."company_id" IS NULL)),
	CONSTRAINT "whatsapp_requests_status_chk" CHECK ("whatsapp_requests"."status" IN ('AWAITING_COMPANY', 'AWAITING_REPLY', 'READY', 'PROCESSING', 'COMPLETED', 'CANCELED', 'EXPIRED', 'FAILED')),
	CONSTRAINT "whatsapp_requests_selected_chk" CHECK ("whatsapp_requests"."status" NOT IN ('AWAITING_REPLY', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED') OR "whatsapp_requests"."company_link_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" DROP CONSTRAINT "whatsapp_outbound_messages_status_chk";--> statement-breakpoint
DROP INDEX "whatsapp_links_connection_user_active_uq";--> statement-breakpoint
ALTER TABLE "whatsapp_sessions" ALTER COLUMN "active_company_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD COLUMN "company_link_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_consent_events" ADD COLUMN "company_link_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD COLUMN "mode" varchar(20) DEFAULT 'NEW_NUMBER' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD COLUMN "expected_link_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD COLUMN "company_link_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_identity_owner_uq" UNIQUE("id","connection_id","user_id");--> statement-breakpoint
ALTER TABLE "whatsapp_link_companies" ADD CONSTRAINT "whatsapp_link_companies_challenge_id_whatsapp_link_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."whatsapp_link_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_companies" ADD CONSTRAINT "whatsapp_link_companies_identity_fk" FOREIGN KEY ("link_id","connection_id","user_id") REFERENCES "public"."whatsapp_links"("id","connection_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_companies" ADD CONSTRAINT "whatsapp_link_companies_membership_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_requests" ADD CONSTRAINT "whatsapp_requests_link_id_whatsapp_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_requests" ADD CONSTRAINT "whatsapp_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_requests" ADD CONSTRAINT "whatsapp_requests_source_inbox_event_id_whatsapp_inbox_events_id_fk" FOREIGN KEY ("source_inbox_event_id") REFERENCES "public"."whatsapp_inbox_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_requests" ADD CONSTRAINT "whatsapp_requests_company_context_fk" FOREIGN KEY ("company_link_id","link_id","company_id","user_id") REFERENCES "public"."whatsapp_link_companies"("id","link_id","company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_link_companies_user_company_active_uq" ON "whatsapp_link_companies" USING btree ("connection_id","user_id","company_id") WHERE "whatsapp_link_companies"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_link_companies_link_company_active_uq" ON "whatsapp_link_companies" USING btree ("link_id","company_id") WHERE "whatsapp_link_companies"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "whatsapp_requests_link_state_idx" ON "whatsapp_requests" USING btree ("link_id","status","created_at");--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_company_link_id_whatsapp_link_companies_id_fk" FOREIGN KEY ("company_link_id") REFERENCES "public"."whatsapp_link_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_request_id_whatsapp_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."whatsapp_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_consent_events" ADD CONSTRAINT "whatsapp_consent_events_company_link_id_whatsapp_link_companies_id_fk" FOREIGN KEY ("company_link_id") REFERENCES "public"."whatsapp_link_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD CONSTRAINT "whatsapp_link_challenges_expected_link_id_whatsapp_links_id_fk" FOREIGN KEY ("expected_link_id") REFERENCES "public"."whatsapp_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_company_link_id_whatsapp_link_companies_id_fk" FOREIGN KEY ("company_link_id") REFERENCES "public"."whatsapp_link_companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_request_id_whatsapp_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."whatsapp_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_link_challenges" ADD CONSTRAINT "whatsapp_link_challenges_mode_chk" CHECK (("whatsapp_link_challenges"."mode" = 'NEW_NUMBER' AND "whatsapp_link_challenges"."expected_link_id" IS NULL) OR ("whatsapp_link_challenges"."mode" = 'EXISTING_NUMBER' AND "whatsapp_link_challenges"."expected_link_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_status_chk" CHECK ("whatsapp_outbound_messages"."status" IN ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELED'));
--> statement-breakpoint
-- Restore only the company proved by the original confirmed QR challenge.
-- The old session company can have been changed later and is not evidence.
WITH proven AS (
  SELECT l.id AS link_id, l.connection_id, l.user_id, l.status, l.verified_at, l.revoked_at,
    c.id AS challenge_id, c.company_id, count(*) OVER (PARTITION BY l.id) AS match_count
  FROM whatsapp_links l
  JOIN whatsapp_link_challenges c ON c.connection_id = l.connection_id AND c.user_id = l.user_id
    AND c.candidate_sender_id = l.sender_id AND c.status = 'CONFIRMED'
    AND c.confirmed_at BETWEEN l.verified_at - interval '10 seconds' AND l.verified_at + interval '10 seconds'
)
INSERT INTO whatsapp_link_companies (link_id, connection_id, user_id, company_id, challenge_id, status, verified_at, revoked_at)
SELECT link_id, connection_id, user_id, company_id, challenge_id, status, verified_at, revoked_at
FROM proven WHERE match_count = 1;
--> statement-breakpoint
-- Business responses queued under the old mutable context must not be sent.
UPDATE whatsapp_outbound_messages SET status = 'CANCELED',
  failure_reason = 'Resposta anterior à migração dos vínculos empresariais', updated_at = now()
WHERE company_id IS NOT NULL AND status IN ('QUEUED', 'SENDING');
