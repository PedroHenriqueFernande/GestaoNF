CREATE TABLE "crm_meeting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"kind" varchar(32) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_meeting_events_kind_chk" CHECK ("crm_meeting_events"."kind" IN ('CREATED','UPDATED','RESCHEDULED','STATUS_CHANGED','PARTICIPANTS_CHANGED','REMINDERS_CHANGED')),
	CONSTRAINT "crm_meeting_events_actor_chk" CHECK ("crm_meeting_events"."actor_type" IN ('USER','NERO','SYSTEM') AND ("crm_meeting_events"."actor_type" = 'SYSTEM' OR "crm_meeting_events"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "crm_meeting_events_changes_chk" CHECK (jsonb_typeof("crm_meeting_events"."changes") = 'object'),
	CONSTRAINT "crm_meeting_events_note_chk" CHECK ("crm_meeting_events"."note" IS NULL OR length("crm_meeting_events"."note") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "crm_meeting_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"contact_id" uuid,
	"user_id" uuid,
	"name" varchar(200),
	"email" varchar(254),
	"phone" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_meeting_participants_kind_chk" CHECK (("crm_meeting_participants"."kind" = 'CONTACT' AND "crm_meeting_participants"."contact_id" IS NOT NULL AND "crm_meeting_participants"."user_id" IS NULL) OR ("crm_meeting_participants"."kind" = 'USER' AND "crm_meeting_participants"."user_id" IS NOT NULL AND "crm_meeting_participants"."contact_id" IS NULL) OR ("crm_meeting_participants"."kind" = 'EXTERNAL' AND "crm_meeting_participants"."user_id" IS NULL AND "crm_meeting_participants"."contact_id" IS NULL AND ("crm_meeting_participants"."name" IS NOT NULL OR "crm_meeting_participants"."email" IS NOT NULL OR "crm_meeting_participants"."phone" IS NOT NULL))),
	CONSTRAINT "crm_meeting_participants_email_chk" CHECK ("crm_meeting_participants"."email" IS NULL OR "crm_meeting_participants"."email" = lower(btrim("crm_meeting_participants"."email")))
);
--> statement-breakpoint
CREATE TABLE "crm_meeting_reminder_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"schedule_revision" integer NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_reminder_occurrences_company_id_uq" UNIQUE("company_id","recipient_user_id","id"),
	CONSTRAINT "crm_reminder_occurrences_delivery_uq" UNIQUE("company_id","meeting_id","rule_id","schedule_revision","recipient_user_id"),
	CONSTRAINT "crm_reminder_occurrences_revision_chk" CHECK ("crm_meeting_reminder_occurrences"."schedule_revision" >= 1),
	CONSTRAINT "crm_reminder_occurrences_status_chk" CHECK ("crm_meeting_reminder_occurrences"."status" IN ('PENDING','DELIVERED','CANCELED','EXPIRED')),
	CONSTRAINT "crm_reminder_occurrences_delivery_chk" CHECK (("crm_meeting_reminder_occurrences"."status" = 'DELIVERED') = ("crm_meeting_reminder_occurrences"."delivered_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "crm_meeting_reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"minutes_before" integer NOT NULL,
	"channel" varchar(16) DEFAULT 'IN_APP' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_meeting_reminders_id_uq" UNIQUE("company_id","meeting_id","id"),
	CONSTRAINT "crm_meeting_reminders_minutes_chk" CHECK ("crm_meeting_reminder_rules"."minutes_before" >= 0 AND "crm_meeting_reminder_rules"."minutes_before" <= 10080),
	CONSTRAINT "crm_meeting_reminders_channel_chk" CHECK ("crm_meeting_reminder_rules"."channel" IN ('IN_APP'))
);
--> statement-breakpoint
CREATE TABLE "crm_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"title" varchar(200) NOT NULL,
	"assigned_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"modality" varchar(16) NOT NULL,
	"location" varchar(500),
	"meeting_url" varchar(2000),
	"description" text,
	"notes" text,
	"status" varchar(20) DEFAULT 'SCHEDULED' NOT NULL,
	"outcome_notes" text,
	"next_steps" text,
	"cancellation_reason" varchar(1000),
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"command_namespace" varchar(160) DEFAULT 'crm.meetings.create' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"creation_result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_meetings_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_meetings_contact_id_uq" UNIQUE("company_id","contact_id","id"),
	CONSTRAINT "crm_meetings_command_uq" UNIQUE("company_id","command_namespace","idempotency_key"),
	CONSTRAINT "crm_meetings_title_chk" CHECK (length(btrim("crm_meetings"."title")) > 0),
	CONSTRAINT "crm_meetings_period_chk" CHECK ("crm_meetings"."ends_at" > "crm_meetings"."starts_at"),
	CONSTRAINT "crm_meetings_timezone_chk" CHECK (length(btrim("crm_meetings"."timezone")) > 0),
	CONSTRAINT "crm_meetings_modality_chk" CHECK ("crm_meetings"."modality" IN ('IN_PERSON','ONLINE')),
	CONSTRAINT "crm_meetings_status_chk" CHECK ("crm_meetings"."status" IN ('SCHEDULED','COMPLETED','CANCELED','NO_SHOW')),
	CONSTRAINT "crm_meetings_lifecycle_chk" CHECK (("crm_meetings"."status" = 'COMPLETED') = ("crm_meetings"."completed_at" IS NOT NULL) AND ("crm_meetings"."status" = 'CANCELED') = ("crm_meetings"."canceled_at" IS NOT NULL)),
	CONSTRAINT "crm_meetings_version_chk" CHECK ("crm_meetings"."version" >= 1),
	CONSTRAINT "crm_meetings_revision_chk" CHECK ("crm_meetings"."schedule_revision" >= 1),
	CONSTRAINT "crm_meetings_command_chk" CHECK (length(btrim("crm_meetings"."command_namespace")) > 0 AND length(btrim("crm_meetings"."idempotency_key")) > 0 AND "crm_meetings"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "crm_meetings_text_chk" CHECK (("crm_meetings"."description" IS NULL OR length("crm_meetings"."description") <= 10000) AND ("crm_meetings"."notes" IS NULL OR length("crm_meetings"."notes") <= 10000) AND ("crm_meetings"."outcome_notes" IS NULL OR length("crm_meetings"."outcome_notes") <= 10000) AND ("crm_meetings"."next_steps" IS NULL OR length("crm_meetings"."next_steps") <= 10000))
);
--> statement-breakpoint
CREATE TABLE "crm_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"qualify_opportunity_on_meeting" boolean DEFAULT true NOT NULL,
	"default_reminder_minutes" integer DEFAULT 30,
	"conflict_policy" varchar(16) DEFAULT 'WARN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_settings_reminder_chk" CHECK ("crm_settings"."default_reminder_minutes" IS NULL OR ("crm_settings"."default_reminder_minutes" >= 0 AND "crm_settings"."default_reminder_minutes" <= 10080)),
	CONSTRAINT "crm_settings_conflict_policy_chk" CHECK ("crm_settings"."conflict_policy" IN ('WARN','ALLOW')),
	CONSTRAINT "crm_settings_version_chk" CHECK ("crm_settings"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"meeting_id" uuid NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notifications_occurrence_uq" UNIQUE("occurrence_id")
);
--> statement-breakpoint
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_kind_chk";--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "meeting_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_meeting_events" ADD CONSTRAINT "crm_meeting_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_events" ADD CONSTRAINT "crm_meeting_events_meeting_fk" FOREIGN KEY ("company_id","contact_id","meeting_id") REFERENCES "public"."crm_meetings"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_events" ADD CONSTRAINT "crm_meeting_events_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."crm_contacts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_events" ADD CONSTRAINT "crm_meeting_events_opportunity_fk" FOREIGN KEY ("company_id","contact_id","opportunity_id") REFERENCES "public"."crm_opportunities"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_events" ADD CONSTRAINT "crm_meeting_events_actor_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_participants" ADD CONSTRAINT "crm_meeting_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_participants" ADD CONSTRAINT "crm_meeting_participants_meeting_fk" FOREIGN KEY ("company_id","meeting_id") REFERENCES "public"."crm_meetings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_participants" ADD CONSTRAINT "crm_meeting_participants_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."crm_contacts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_participants" ADD CONSTRAINT "crm_meeting_participants_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_reminder_occurrences" ADD CONSTRAINT "crm_reminder_occurrences_rule_fk" FOREIGN KEY ("company_id","meeting_id","rule_id") REFERENCES "public"."crm_meeting_reminder_rules"("company_id","meeting_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_reminder_occurrences" ADD CONSTRAINT "crm_reminder_occurrences_user_fk" FOREIGN KEY ("company_id","recipient_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_reminder_rules" ADD CONSTRAINT "crm_meeting_reminder_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meeting_reminder_rules" ADD CONSTRAINT "crm_meeting_reminders_meeting_fk" FOREIGN KEY ("company_id","meeting_id") REFERENCES "public"."crm_meetings"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."crm_contacts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_opportunity_fk" FOREIGN KEY ("company_id","contact_id","opportunity_id") REFERENCES "public"."crm_opportunities"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_assignee_fk" FOREIGN KEY ("company_id","assigned_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_creator_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_occurrence_fk" FOREIGN KEY ("company_id","recipient_user_id","occurrence_id") REFERENCES "public"."crm_meeting_reminder_occurrences"("company_id","recipient_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_meeting_fk" FOREIGN KEY ("company_id","meeting_id") REFERENCES "public"."crm_meetings"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_meeting_events_meeting_idx" ON "crm_meeting_events" USING btree ("company_id","meeting_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_meeting_participants_contact_uq" ON "crm_meeting_participants" USING btree ("company_id","meeting_id","contact_id") WHERE "crm_meeting_participants"."contact_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_meeting_participants_user_uq" ON "crm_meeting_participants" USING btree ("company_id","meeting_id","user_id") WHERE "crm_meeting_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_meeting_participants_meeting_idx" ON "crm_meeting_participants" USING btree ("company_id","meeting_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_reminder_occurrences_due_idx" ON "crm_meeting_reminder_occurrences" USING btree ("status","remind_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_meeting_reminders_rule_uq" ON "crm_meeting_reminder_rules" USING btree ("company_id","meeting_id","channel","minutes_before") WHERE "crm_meeting_reminder_rules"."active";--> statement-breakpoint
CREATE INDEX "crm_meetings_calendar_idx" ON "crm_meetings" USING btree ("company_id","starts_at","id");--> statement-breakpoint
CREATE INDEX "crm_meetings_assignee_idx" ON "crm_meetings" USING btree ("company_id","assigned_user_id","starts_at","id");--> statement-breakpoint
CREATE INDEX "crm_meetings_contact_idx" ON "crm_meetings" USING btree ("company_id","contact_id","starts_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_meetings_opportunity_idx" ON "crm_meetings" USING btree ("company_id","opportunity_id","starts_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "crm_meetings"."opportunity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "user_notifications_inbox_idx" ON "user_notifications" USING btree ("company_id","recipient_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_meeting_fk" FOREIGN KEY ("company_id","contact_id","meeting_id") REFERENCES "public"."crm_meetings"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_activities_meeting_idx" ON "crm_activities" USING btree ("company_id","meeting_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "crm_activities"."meeting_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_kind_chk" CHECK ("crm_activities"."kind" IN ('CONTACT_CREATED','ENTRY_RECEIVED','OPPORTUNITY_CREATED','CONTACT_UPDATED','ASSIGNED','STAGE_CHANGED','STATUS_CHANGED','NOTE_ADDED','CUSTOMER_LINKED','ARCHIVED','RESTORED','MEETING_CREATED','MEETING_UPDATED','MEETING_RESCHEDULED','MEETING_STATUS_CHANGED'));