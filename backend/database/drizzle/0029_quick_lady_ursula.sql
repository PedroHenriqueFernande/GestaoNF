CREATE TABLE "nfse_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"environment" varchar(16) NOT NULL,
	"event_type" varchar(6) NOT NULL,
	"reason_code" varchar(2) NOT NULL,
	"reason_text" text NOT NULL,
	"identifier" varchar(59) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"signed_xml" text,
	"signed_xml_sha256" varchar(64),
	"certificate_id" uuid,
	"official_xml" text,
	"official_xml_sha256" varchar(64),
	"sequence_number" integer,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"next_action_at" timestamp with time zone,
	"request_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_document_events_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_document_events_request_key_uq" UNIQUE("company_id","request_key"),
	CONSTRAINT "nfse_document_events_environment_chk" CHECK ("nfse_document_events"."environment" IN ('HOMOLOGATION','PRODUCTION')),
	CONSTRAINT "nfse_document_events_type_chk" CHECK ("nfse_document_events"."event_type" IN ('101101')),
	CONSTRAINT "nfse_document_events_status_chk" CHECK ("nfse_document_events"."status" IN ('PENDING','READY','SENDING','UNKNOWN','REGISTERED','REJECTED')),
	CONSTRAINT "nfse_document_events_reason_chk" CHECK ("nfse_document_events"."reason_code" IN ('1','2','9') AND char_length("nfse_document_events"."reason_text") BETWEEN 15 AND 255),
	CONSTRAINT "nfse_document_events_request_hash_chk" CHECK ("nfse_document_events"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" DROP CONSTRAINT "nfse_emissions_sale_environment_uq";--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" DROP CONSTRAINT "nfse_attempts_operation_chk";--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" ALTER COLUMN "dps_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "status" varchar(16) DEFAULT 'AUTHORIZED' NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substituted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substituted_by_document_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substitution_reason_code" varchar(2);--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substitution_reason_text" text;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substitution_opened_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substitution_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD COLUMN "substitution_sale_version" integer;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD COLUMN "kind" varchar(16) DEFAULT 'ISSUE' NOT NULL;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD COLUMN "previous_emission_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD COLUMN "substitutes_document_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" ADD COLUMN "document_event_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_document_events" ADD CONSTRAINT "nfse_document_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_document_events" ADD CONSTRAINT "nfse_document_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_document_events" ADD CONSTRAINT "nfse_document_events_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."nfse_documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_document_events" ADD CONSTRAINT "nfse_document_events_certificate_fk" FOREIGN KEY ("company_id","certificate_id") REFERENCES "public"."company_fiscal_certificates"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_document_events_active_uq" ON "nfse_document_events" USING btree ("document_id","event_type") WHERE "nfse_document_events"."status"<>'REJECTED';--> statement-breakpoint
CREATE UNIQUE INDEX "nfse_document_events_identifier_uq" ON "nfse_document_events" USING btree ("environment","identifier") WHERE "nfse_document_events"."status"<>'REJECTED';--> statement-breakpoint
CREATE INDEX "nfse_document_events_document_idx" ON "nfse_document_events" USING btree ("company_id","document_id","created_at");--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_substitution_opened_by_user_id_users_id_fk" FOREIGN KEY ("substitution_opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_substituted_by_fk" FOREIGN KEY ("company_id","substituted_by_document_id") REFERENCES "public"."nfse_documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emissions_previous_fk" FOREIGN KEY ("company_id","previous_emission_id") REFERENCES "public"."nfse_emission_requests"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emissions_substitutes_fk" FOREIGN KEY ("company_id","substitutes_document_id") REFERENCES "public"."nfse_documents"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" ADD CONSTRAINT "nfse_attempts_event_fk" FOREIGN KEY ("company_id","document_event_id") REFERENCES "public"."nfse_document_events"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nfse_emissions_sale_idx" ON "nfse_emission_requests" USING btree ("company_id","sale_id","environment","created_at");--> statement-breakpoint
CREATE INDEX "nfse_attempts_event_idx" ON "nfse_transmission_attempts" USING btree ("company_id","document_event_id","started_at");--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_status_chk" CHECK ("nfse_documents"."status" IN ('AUTHORIZED','CANCELLED','SUBSTITUTED'));--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_substitution_code_chk" CHECK ("nfse_documents"."substitution_reason_code" IS NULL OR "nfse_documents"."substitution_reason_code" IN ('01','02','03','04','05','99'));--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_substitution_text_chk" CHECK ("nfse_documents"."substitution_reason_text" IS NULL OR char_length("nfse_documents"."substitution_reason_text") BETWEEN 15 AND 255);--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_substitution_open_chk" CHECK (("nfse_documents"."substitution_reason_code" IS NULL) = ("nfse_documents"."substitution_opened_by_user_id" IS NULL) AND ("nfse_documents"."substitution_reason_code" IS NULL) = ("nfse_documents"."substitution_opened_at" IS NULL) AND ("nfse_documents"."substitution_reason_code" IS NULL) = ("nfse_documents"."substitution_sale_version" IS NULL));--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_substitution_99_chk" CHECK ("nfse_documents"."substitution_reason_code" IS DISTINCT FROM '99' OR "nfse_documents"."substitution_reason_text" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emissions_kind_chk" CHECK ("nfse_emission_requests"."kind" IN ('ISSUE','SUBSTITUTION'));--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emissions_substitution_chk" CHECK (("nfse_emission_requests"."kind"='SUBSTITUTION') = ("nfse_emission_requests"."substitutes_document_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" ADD CONSTRAINT "nfse_attempts_target_chk" CHECK (("nfse_transmission_attempts"."dps_id" IS NOT NULL) <> ("nfse_transmission_attempts"."document_event_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" ADD CONSTRAINT "nfse_attempts_operation_chk" CHECK ("nfse_transmission_attempts"."operation" IN ('SEND','LOOKUP_DPS','FETCH_NFSE','SEND_EVENT','LOOKUP_EVENT'));