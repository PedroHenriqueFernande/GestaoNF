-- Proposals: generated schema followed by deferred integrity constraints.
CREATE TABLE "crm_proposal_commands" (
	"company_id" uuid NOT NULL,
	"namespace" varchar(160) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"proposal_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_proposal_commands_company_id_namespace_idempotency_key_pk" PRIMARY KEY("company_id","namespace","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "crm_proposal_counters" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "crm_proposal_counter_positive_chk" CHECK ("crm_proposal_counters"."next_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "crm_proposal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_user_id" uuid,
	"event_type" varchar(32) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_proposal_events_actor_chk" CHECK ("crm_proposal_events"."actor_type" IN ('USER','NERO','SYSTEM') AND ("crm_proposal_events"."actor_type" = 'SYSTEM' OR "crm_proposal_events"."actor_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "crm_proposal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"service_name_snapshot" varchar(200) NOT NULL,
	"description_snapshot" text,
	"unit_label_snapshot" varchar(16) NOT NULL,
	"national_tax_code_snapshot" varchar(6),
	"nbs_code_snapshot" varchar(9),
	"quantity" numeric(15, 4) NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"gross_amount" numeric(15, 2) NOT NULL,
	"discount_type" varchar(16) DEFAULT 'AMOUNT' NOT NULL,
	"discount_input" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	CONSTRAINT "crm_proposal_items_position_uq" UNIQUE("company_id","proposal_id","position"),
	CONSTRAINT "crm_proposal_items_totals_chk" CHECK ("crm_proposal_items"."position" > 0 AND "crm_proposal_items"."quantity" > 0 AND "crm_proposal_items"."unit_price" >= 0 AND "crm_proposal_items"."gross_amount" = round("crm_proposal_items"."quantity" * "crm_proposal_items"."unit_price", 2) AND "crm_proposal_items"."discount_amount" >= 0 AND "crm_proposal_items"."discount_amount" <= "crm_proposal_items"."gross_amount" AND "crm_proposal_items"."total_amount" = "crm_proposal_items"."gross_amount" - "crm_proposal_items"."discount_amount"),
	CONSTRAINT "crm_proposal_items_discount_chk" CHECK ("crm_proposal_items"."discount_input" >= 0 AND (("crm_proposal_items"."discount_type" = 'AMOUNT' AND "crm_proposal_items"."discount_amount" = "crm_proposal_items"."discount_input") OR ("crm_proposal_items"."discount_type" = 'PERCENT' AND "crm_proposal_items"."discount_input" <= 100 AND "crm_proposal_items"."discount_amount" = round("crm_proposal_items"."gross_amount" * "crm_proposal_items"."discount_input" / 100, 2))))
);
--> statement-breakpoint
CREATE TABLE "crm_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"proposal_number" integer NOT NULL,
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"replaces_proposal_id" uuid,
	"title" varchar(200) NOT NULL,
	"recipient_name" varchar(200) NOT NULL,
	"recipient_organization" varchar(200),
	"recipient_email" varchar(254),
	"recipient_tax_id" varchar(14),
	"commercial_description" text,
	"payment_terms" text,
	"notes" text,
	"terms" text,
	"valid_until" date,
	"subtotal_amount" numeric(15, 2) NOT NULL,
	"discount_amount" numeric(15, 2) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"issued_snapshot" jsonb,
	"issued_hash" char(64),
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" varchar(1000),
	"converted_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_proposals_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "crm_proposals_context_id_uq" UNIQUE("company_id","contact_id","opportunity_id","id"),
	CONSTRAINT "crm_proposals_number_uq" UNIQUE("company_id","proposal_number"),
	CONSTRAINT "crm_proposals_status_chk" CHECK ("crm_proposals"."status" IN ('DRAFT','SENT','ACCEPTED','DECLINED','CONVERTED')),
	CONSTRAINT "crm_proposals_identity_chk" CHECK ("crm_proposals"."proposal_number" > 0 AND "crm_proposals"."version" > 0 AND length(btrim("crm_proposals"."title")) > 0 AND length(btrim("crm_proposals"."recipient_name")) > 0),
	CONSTRAINT "crm_proposals_totals_chk" CHECK ("crm_proposals"."subtotal_amount" >= 0 AND "crm_proposals"."discount_amount" >= 0 AND "crm_proposals"."discount_amount" <= "crm_proposals"."subtotal_amount" AND "crm_proposals"."total_amount" = "crm_proposals"."subtotal_amount" - "crm_proposals"."discount_amount"),
	CONSTRAINT "crm_proposals_issue_chk" CHECK (("crm_proposals"."status" = 'DRAFT' AND "crm_proposals"."issued_snapshot" IS NULL AND "crm_proposals"."issued_hash" IS NULL AND "crm_proposals"."sent_at" IS NULL) OR ("crm_proposals"."status" <> 'DRAFT' AND "crm_proposals"."issued_snapshot" IS NOT NULL AND "crm_proposals"."issued_hash" IS NOT NULL AND jsonb_typeof("crm_proposals"."issued_snapshot") = 'object' AND "crm_proposals"."issued_hash" ~ '^[a-f0-9]{64}$' AND "crm_proposals"."sent_at" IS NOT NULL)),
	CONSTRAINT "crm_proposals_dates_chk" CHECK (("crm_proposals"."accepted_at" IS NOT NULL) = ("crm_proposals"."status" IN ('ACCEPTED','CONVERTED')) AND ("crm_proposals"."declined_at" IS NOT NULL) = ("crm_proposals"."status" = 'DECLINED') AND ("crm_proposals"."converted_at" IS NOT NULL) = ("crm_proposals"."status" = 'CONVERTED'))
);
--> statement-breakpoint
ALTER TABLE "crm_activities" DROP CONSTRAINT "crm_activities_kind_chk";--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD COLUMN "win_opportunity_on_proposal_conversion" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD COLUMN "proposal_sent_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "source_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "crm_proposal_commands" ADD CONSTRAINT "crm_proposal_commands_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposal_commands" ADD CONSTRAINT "crm_proposal_commands_proposal_fk" FOREIGN KEY ("company_id","proposal_id") REFERENCES "public"."crm_proposals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposal_counters" ADD CONSTRAINT "crm_proposal_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposal_events" ADD CONSTRAINT "crm_proposal_events_proposal_fk" FOREIGN KEY ("company_id","proposal_id") REFERENCES "public"."crm_proposals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposal_events" ADD CONSTRAINT "crm_proposal_events_actor_fk" FOREIGN KEY ("company_id","actor_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposal_items" ADD CONSTRAINT "crm_proposal_items_proposal_fk" FOREIGN KEY ("company_id","proposal_id") REFERENCES "public"."crm_proposals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposal_items" ADD CONSTRAINT "crm_proposal_items_service_fk" FOREIGN KEY ("company_id","service_id") REFERENCES "public"."services"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_opportunity_fk" FOREIGN KEY ("company_id","contact_id","opportunity_id") REFERENCES "public"."crm_opportunities"("company_id","contact_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_customer_fk" FOREIGN KEY ("company_id","customer_id") REFERENCES "public"."customers"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_previous_fk" FOREIGN KEY ("company_id","replaces_proposal_id") REFERENCES "public"."crm_proposals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_creator_fk" FOREIGN KEY ("company_id","created_by_user_id") REFERENCES "public"."company_users"("company_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_proposal_events_history_idx" ON "crm_proposal_events" USING btree ("company_id","proposal_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_proposals_recent_idx" ON "crm_proposals" USING btree ("company_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_proposals_opportunity_idx" ON "crm_proposals" USING btree ("company_id","opportunity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_proposals_customer_idx" ON "crm_proposals" USING btree ("company_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_proposals_expiry_idx" ON "crm_proposals" USING btree ("company_id","status","valid_until");--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_proposal_fk" FOREIGN KEY ("company_id","contact_id","opportunity_id","proposal_id") REFERENCES "public"."crm_proposals"("company_id","contact_id","opportunity_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_proposal_stage_fk" FOREIGN KEY ("company_id","proposal_sent_stage_id") REFERENCES "public"."crm_pipeline_stages"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_source_proposal_fk" FOREIGN KEY ("company_id","source_proposal_id") REFERENCES "public"."crm_proposals"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_source_proposal_uq" ON "sales" USING btree ("company_id","source_proposal_id") WHERE "sales"."source_proposal_id" IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION crm_proposal_validate_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; target_company uuid; p crm_proposals%ROWTYPE; item_count bigint; gross numeric; discount numeric;
BEGIN
  IF TG_TABLE_NAME = 'crm_proposals' THEN
    target_id := NEW.id; target_company := NEW.company_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_id := OLD.proposal_id; target_company := OLD.company_id;
  ELSE
    target_id := NEW.proposal_id; target_company := NEW.company_id;
  END IF;
  SELECT * INTO p FROM crm_proposals WHERE id = target_id AND company_id = target_company;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*), coalesce(sum(gross_amount),0), coalesce(sum(discount_amount),0)
    INTO item_count, gross, discount FROM crm_proposal_items WHERE proposal_id = target_id AND company_id = target_company;
  IF item_count = 0 OR item_count > 100 OR p.subtotal_amount <> gross OR p.discount_amount <> discount OR p.total_amount <> gross - discount THEN
    RAISE EXCEPTION 'Proposal requires items with matching totals' USING ERRCODE = '23514', CONSTRAINT = 'crm_proposal_items_required_chk';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER crm_proposal_header_items_check AFTER INSERT OR UPDATE ON crm_proposals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crm_proposal_validate_items();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER crm_proposal_items_check AFTER INSERT OR UPDATE OR DELETE ON crm_proposal_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crm_proposal_validate_items();--> statement-breakpoint
CREATE FUNCTION crm_proposal_freeze_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; target_company uuid; current_status varchar;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.proposal_id <> OLD.proposal_id OR NEW.company_id <> OLD.company_id) THEN
    RAISE EXCEPTION 'Cannot move proposal items' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN target_id := OLD.proposal_id; target_company := OLD.company_id;
  ELSE target_id := NEW.proposal_id; target_company := NEW.company_id; END IF;
  SELECT status INTO current_status FROM crm_proposals WHERE id = target_id AND company_id = target_company FOR SHARE;
  IF current_status <> 'DRAFT' THEN RAISE EXCEPTION 'Issued proposal items are immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;--> statement-breakpoint
CREATE TRIGGER crm_proposal_items_frozen BEFORE INSERT OR UPDATE OR DELETE ON crm_proposal_items
  FOR EACH ROW EXECUTE FUNCTION crm_proposal_freeze_items();--> statement-breakpoint
CREATE FUNCTION crm_proposal_freeze_header() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND
    (to_jsonb(NEW) - ARRAY['status','version','updated_at','accepted_at','declined_at','decline_reason','converted_at']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','version','updated_at','accepted_at','declined_at','decline_reason','converted_at']) THEN
    RAISE EXCEPTION 'Issued proposal document is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SENT') OR (OLD.status = 'SENT' AND NEW.status IN ('ACCEPTED','DECLINED')) OR (OLD.status = 'ACCEPTED' AND NEW.status = 'CONVERTED')) THEN
    RAISE EXCEPTION 'Invalid proposal transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER crm_proposal_header_frozen BEFORE UPDATE ON crm_proposals FOR EACH ROW EXECUTE FUNCTION crm_proposal_freeze_header();--> statement-breakpoint
CREATE FUNCTION crm_proposal_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Proposal audit events are immutable' USING ERRCODE = '23514'; END $$;--> statement-breakpoint
CREATE TRIGGER crm_proposal_events_frozen BEFORE UPDATE OR DELETE ON crm_proposal_events FOR EACH ROW EXECUTE FUNCTION crm_proposal_events_immutable();--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_kind_chk" CHECK ("crm_activities"."kind" IN ('CONTACT_CREATED','ENTRY_RECEIVED','OPPORTUNITY_CREATED','CONTACT_UPDATED','ASSIGNED','STAGE_CHANGED','STATUS_CHANGED','NOTE_ADDED','CUSTOMER_LINKED','ARCHIVED','RESTORED','MEETING_CREATED','MEETING_UPDATED','MEETING_RESCHEDULED','MEETING_STATUS_CHANGED','PROPOSAL_CREATED','PROPOSAL_UPDATED','PROPOSAL_SENT','PROPOSAL_ACCEPTED','PROPOSAL_DECLINED','PROPOSAL_CONVERTED'));
