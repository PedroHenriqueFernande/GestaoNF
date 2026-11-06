CREATE TABLE "nfse_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dps_id" uuid NOT NULL,
	"environment" varchar(16) NOT NULL,
	"access_key" varchar(50) NOT NULL,
	"number" varchar(30) NOT NULL,
	"official_xml" text NOT NULL,
	"xml_sha256" varchar(64) NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"archive_status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"archive_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_documents_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_documents_dps_uq" UNIQUE("company_id","dps_id"),
	CONSTRAINT "nfse_documents_key_uq" UNIQUE("environment","access_key"),
	CONSTRAINT "nfse_documents_environment_chk" CHECK ("nfse_documents"."environment" IN ('HOMOLOGATION','PRODUCTION')),
	CONSTRAINT "nfse_documents_archive_status_chk" CHECK ("nfse_documents"."archive_status" IN ('PENDING','ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "nfse_emission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"environment" varchar(16) NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_emissions_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_emissions_request_key_uq" UNIQUE("company_id","request_key"),
	CONSTRAINT "nfse_emissions_sale_environment_uq" UNIQUE("company_id","sale_id","environment"),
	CONSTRAINT "nfse_emissions_environment_chk" CHECK ("nfse_emission_requests"."environment" IN ('HOMOLOGATION','PRODUCTION'))
);
--> statement-breakpoint
CREATE TABLE "nfse_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"emission_id" uuid NOT NULL,
	"dps_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(40) NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nfse_previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_version" integer NOT NULL,
	"request_key" uuid NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"snapshot_hash" varchar(64) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nfse_previews_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "nfse_previews_request_key_uq" UNIQUE("company_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "nfse_transmission_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"dps_id" uuid NOT NULL,
	"operation" varchar(16) NOT NULL,
	"outcome" varchar(24) DEFAULT 'STARTED' NOT NULL,
	"http_status" integer,
	"error_code" varchar(80),
	"message" text,
	"response" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "nfse_attempts_operation_chk" CHECK ("nfse_transmission_attempts"."operation" IN ('SEND','LOOKUP_DPS','FETCH_NFSE'))
);
--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "emission_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "group_key" varchar(64);--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "identifier" varchar(45);--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "signed_xml" text;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "signed_xml_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "certificate_id" uuid;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD COLUMN "next_action_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_company_id_id_uq" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "nfse_documents" ADD CONSTRAINT "nfse_documents_dps_fk" FOREIGN KEY ("company_id","dps_id") REFERENCES "public"."nfse_dps"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emission_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emissions_sale_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_emission_requests" ADD CONSTRAINT "nfse_emissions_preview_fk" FOREIGN KEY ("company_id","preview_id") REFERENCES "public"."nfse_previews"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_events" ADD CONSTRAINT "nfse_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_events" ADD CONSTRAINT "nfse_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_events" ADD CONSTRAINT "nfse_events_emission_fk" FOREIGN KEY ("company_id","emission_id") REFERENCES "public"."nfse_emission_requests"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_events" ADD CONSTRAINT "nfse_events_dps_fk" FOREIGN KEY ("company_id","dps_id") REFERENCES "public"."nfse_dps"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_previews" ADD CONSTRAINT "nfse_previews_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_previews" ADD CONSTRAINT "nfse_previews_sale_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_transmission_attempts" ADD CONSTRAINT "nfse_attempts_dps_fk" FOREIGN KEY ("company_id","dps_id") REFERENCES "public"."nfse_dps"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nfse_events_emission_idx" ON "nfse_events" USING btree ("company_id","emission_id","created_at");--> statement-breakpoint
CREATE INDEX "nfse_previews_sale_idx" ON "nfse_previews" USING btree ("company_id","sale_id","created_at");--> statement-breakpoint
CREATE INDEX "nfse_attempts_dps_idx" ON "nfse_transmission_attempts" USING btree ("company_id","dps_id","started_at");--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_emission_fk" FOREIGN KEY ("company_id","emission_id") REFERENCES "public"."nfse_emission_requests"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_certificate_fk" FOREIGN KEY ("company_id","certificate_id") REFERENCES "public"."company_fiscal_certificates"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_emission_group_uq" UNIQUE("emission_id","group_key");--> statement-breakpoint
ALTER TABLE "nfse_dps" ADD CONSTRAINT "nfse_dps_environment_identifier_uq" UNIQUE("environment","identifier");