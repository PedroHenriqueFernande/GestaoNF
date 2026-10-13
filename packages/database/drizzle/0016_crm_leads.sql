CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"entry_id" uuid,
	"kind" varchar(40) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cause_reference" varchar(160),
	"command_namespace" varchar(160),
	"idempotency_key" varchar(128),
	"request_hash" char(64),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_activities_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_activities_kind_chk" CHECK ("crm_activities"."kind" IN ('CONTACT_CREATED','ENTRY_RECEIVED','OPPORTUNITY_CREATED','CONTACT_UPDATED','ASSIGNED','STAGE_CHANGED','STATUS_CHANGED','NOTE_ADDED','CUSTOMER_LINKED','ARCHIVED','RESTORED')),
	CONSTRAINT "crm_activities_actor_chk" CHECK ("crm_activities"."actor_type" IN ('USER','NERO','SYSTEM','INTEGRATION') AND ("crm_activities"."actor_type" NOT IN ('USER','NERO') OR "crm_activities"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "crm_activities_note_chk" CHECK ("crm_activities"."note" IS NULL OR length("crm_activities"."note") <= 10000),
	CONSTRAINT "crm_activities_changes_chk" CHECK (jsonb_typeof("crm_activities"."changes") = 'object'),
	CONSTRAINT "crm_activities_command_chk" CHECK (("crm_activities"."command_namespace" IS NULL AND "crm_activities"."idempotency_key" IS NULL AND "crm_activities"."request_hash" IS NULL) OR ("crm_activities"."command_namespace" IS NOT NULL AND length(btrim("crm_activities"."command_namespace")) > 0 AND "crm_activities"."idempotency_key" IS NOT NULL AND length(btrim("crm_activities"."idempotency_key")) > 0 AND "crm_activities"."request_hash" IS NOT NULL AND "crm_activities"."request_hash" ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"organization_name" varchar(200),
	"email" varchar(254),
	"phone" varchar(64),
	"phone_key" varchar(32),
	"tax_id" varchar(14),
	"tax_id_kind" varchar(2),
	"notes" text,
	"assigned_user_id" uuid,
	"customer_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_contacts_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_contacts_name_chk" CHECK (length(btrim("crm_contacts"."name")) > 0),
	CONSTRAINT "crm_contacts_version_chk" CHECK ("crm_contacts"."version" >= 1),
	CONSTRAINT "crm_contacts_tax_chk" CHECK (("crm_contacts"."tax_id" IS NULL AND "crm_contacts"."tax_id_kind" IS NULL) OR ("crm_contacts"."tax_id" IS NOT NULL AND "crm_contacts"."tax_id_kind" IS NOT NULL AND (("crm_contacts"."tax_id_kind" = 'PF' AND "crm_contacts"."tax_id" ~ '^[0-9]{11}$') OR ("crm_contacts"."tax_id_kind" = 'PJ' AND "crm_contacts"."tax_id" ~ '^[A-Z0-9]{12}[0-9]{2}$')))),
	CONSTRAINT "crm_contacts_email_chk" CHECK ("crm_contacts"."email" IS NULL OR "crm_contacts"."email" = lower(btrim("crm_contacts"."email"))),
	CONSTRAINT "crm_contacts_notes_chk" CHECK ("crm_contacts"."notes" IS NULL OR length("crm_contacts"."notes") <= 10000)
);
--> statement-breakpoint
CREATE TABLE "crm_lead_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"capture_kind" varchar(20) NOT NULL,
	"source_label" varchar(120),
	"source_namespace" varchar(160),
	"source_event_id" varchar(200),
	"source_form_reference" varchar(200),
	"external_campaign_id" varchar(200),
	"external_ad_id" varchar(200),
	"utm_source" varchar(200),
	"utm_medium" varchar(200),
	"utm_campaign" varchar(200),
	"utm_content" varchar(200),
	"utm_term" varchar(200),
	"primary_service_id" uuid,
	"interest_description" varchar(2000),
	"submitted_contact" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"command_namespace" varchar(160) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	CONSTRAINT "crm_entries_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_entries_contact_id_uq" UNIQUE("company_id","contact_id","id"),
	CONSTRAINT "crm_entries_command_uq" UNIQUE("company_id","command_namespace","idempotency_key"),
	CONSTRAINT "crm_entries_capture_chk" CHECK ("crm_lead_entries"."capture_kind" IN ('MANUAL','FORM','META_ADS','GOOGLE_ADS','IMPORT','NERO','API')),
	CONSTRAINT "crm_entries_event_chk" CHECK (("crm_lead_entries"."source_namespace" IS NULL) = ("crm_lead_entries"."source_event_id" IS NULL)),
	CONSTRAINT "crm_entries_key_chk" CHECK (length(btrim("crm_lead_entries"."idempotency_key")) > 0 AND length(btrim("crm_lead_entries"."command_namespace")) > 0 AND "crm_lead_entries"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "crm_entries_snapshot_chk" CHECK (jsonb_typeof("crm_lead_entries"."submitted_contact") = 'object')
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"origin_entry_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"primary_service_id" uuid,
	"estimated_amount" numeric(15, 2),
	"expected_close_on" date,
	"commercial_status" varchar(20) DEFAULT 'NEW' NOT NULL,
	"assigned_user_id" uuid,
	"reason_code" varchar(40),
	"reason_text" varchar(1000),
	"closed_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_opportunities_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_opportunities_contact_id_uq" UNIQUE("company_id","contact_id","id"),
	CONSTRAINT "crm_opportunities_entry_uq" UNIQUE("company_id","origin_entry_id"),
	CONSTRAINT "crm_opportunities_title_chk" CHECK (length(btrim("crm_opportunities"."title")) > 0),
	CONSTRAINT "crm_opportunities_version_chk" CHECK ("crm_opportunities"."version" >= 1),
	CONSTRAINT "crm_opportunities_status_chk" CHECK ("crm_opportunities"."commercial_status" IN ('NEW','CONTACTING','QUALIFIED','DISQUALIFIED','LOST','WON')),
	CONSTRAINT "crm_opportunities_amount_chk" CHECK ("crm_opportunities"."estimated_amount" IS NULL OR "crm_opportunities"."estimated_amount" >= 0),
	CONSTRAINT "crm_opportunities_closed_chk" CHECK (("crm_opportunities"."commercial_status" IN ('WON','LOST','DISQUALIFIED')) = ("crm_opportunities"."closed_at" IS NOT NULL)),
	CONSTRAINT "crm_opportunities_reason_chk" CHECK ("crm_opportunities"."commercial_status" IN ('LOST','DISQUALIFIED') OR ("crm_opportunities"."reason_code" IS NULL AND "crm_opportunities"."reason_text" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "crm_pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"position" integer NOT NULL,
	"is_entry" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_stages_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_stages_pipeline_id_uq" UNIQUE("company_id","pipeline_id","id"),
	CONSTRAINT "crm_stages_name_chk" CHECK (length(btrim("crm_pipeline_stages"."name")) > 0),
	CONSTRAINT "crm_stages_position_chk" CHECK ("crm_pipeline_stages"."position" > 0),
	CONSTRAINT "crm_stages_version_chk" CHECK ("crm_pipeline_stages"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "crm_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_pipelines_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_pipelines_name_chk" CHECK (length(btrim("crm_pipelines"."name")) > 0),
	CONSTRAINT "crm_pipelines_version_chk" CHECK ("crm_pipelines"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."crm_contacts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_opportunity_fk" FOREIGN KEY ("company_id","contact_id","opportunity_id") REFERENCES "public"."crm_opportunities"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_entry_fk" FOREIGN KEY ("company_id","contact_id","entry_id") REFERENCES "public"."crm_lead_entries"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_actor_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_assignee_fk" FOREIGN KEY ("company_id","assigned_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_creator_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_entries" ADD CONSTRAINT "crm_lead_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_entries" ADD CONSTRAINT "crm_entries_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."crm_contacts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_entries" ADD CONSTRAINT "crm_entries_service_fk" FOREIGN KEY ("company_id","primary_service_id") REFERENCES "public"."services"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_entries" ADD CONSTRAINT "crm_entries_actor_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."crm_contacts"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_entry_fk" FOREIGN KEY ("company_id","contact_id","origin_entry_id") REFERENCES "public"."crm_lead_entries"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_fk" FOREIGN KEY ("company_id","pipeline_id","stage_id") REFERENCES "public"."crm_pipeline_stages"("company_id","pipeline_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_service_fk" FOREIGN KEY ("company_id","primary_service_id") REFERENCES "public"."services"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_assignee_fk" FOREIGN KEY ("company_id","assigned_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_creator_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_stages_pipeline_fk" FOREIGN KEY ("company_id","pipeline_id") REFERENCES "public"."crm_pipelines"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_creator_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_activities_command_uq" ON "crm_activities" USING btree ("company_id","command_namespace","idempotency_key") WHERE "crm_activities"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_activities_contact_idx" ON "crm_activities" USING btree ("company_id","contact_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_activities_opportunity_idx" ON "crm_activities" USING btree ("company_id","opportunity_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "crm_activities"."opportunity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_contacts_list_idx" ON "crm_contacts" USING btree ("company_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_contacts_assignee_idx" ON "crm_contacts" USING btree ("company_id","assigned_user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_contacts_email_idx" ON "crm_contacts" USING btree ("company_id","email") WHERE "crm_contacts"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_contacts_phone_idx" ON "crm_contacts" USING btree ("company_id","phone_key") WHERE "crm_contacts"."phone_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_contacts_tax_idx" ON "crm_contacts" USING btree ("company_id","tax_id") WHERE "crm_contacts"."tax_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_entries_event_uq" ON "crm_lead_entries" USING btree ("company_id","source_namespace","source_event_id") WHERE "crm_lead_entries"."source_namespace" IS NOT NULL AND "crm_lead_entries"."source_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_entries_contact_idx" ON "crm_lead_entries" USING btree ("company_id","contact_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_entries_date_idx" ON "crm_lead_entries" USING btree ("company_id","received_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_entries_source_idx" ON "crm_lead_entries" USING btree ("company_id",lower(btrim("utm_source"))) WHERE "crm_lead_entries"."utm_source" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_entries_medium_idx" ON "crm_lead_entries" USING btree ("company_id",lower(btrim("utm_medium"))) WHERE "crm_lead_entries"."utm_medium" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_entries_campaign_idx" ON "crm_lead_entries" USING btree ("company_id",lower(btrim("utm_campaign"))) WHERE "crm_lead_entries"."utm_campaign" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "crm_opportunities_contact_idx" ON "crm_opportunities" USING btree ("company_id","contact_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_opportunities_column_idx" ON "crm_opportunities" USING btree ("company_id","pipeline_id","stage_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_opportunities_assignee_idx" ON "crm_opportunities" USING btree ("company_id","assigned_user_id","commercial_status","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_opportunities_status_idx" ON "crm_opportunities" USING btree ("company_id","commercial_status","last_activity_at","id");--> statement-breakpoint
CREATE INDEX "crm_stages_order_idx" ON "crm_pipeline_stages" USING btree ("company_id","pipeline_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_stages_entry_uq" ON "crm_pipeline_stages" USING btree ("company_id","pipeline_id") WHERE "crm_pipeline_stages"."is_entry" AND "crm_pipeline_stages"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipelines_default_uq" ON "crm_pipelines" USING btree ("company_id") WHERE "crm_pipelines"."is_default" AND "crm_pipelines"."archived_at" IS NULL;