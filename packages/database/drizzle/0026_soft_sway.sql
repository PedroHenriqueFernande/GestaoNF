CREATE TABLE "company_fiscal_certificate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_fiscal_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"subject_tax_id" varchar(14) NOT NULL,
	"fingerprint_sha256" char(64) NOT NULL,
	"serial_number" varchar(120) NOT NULL,
	"subject_summary" varchar(500) NOT NULL,
	"issuer_summary" varchar(500) NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"encrypted_payload" text,
	"encryption_key_id" varchar(40) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "company_fiscal_certificates_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "company_fiscal_certificates_company_fingerprint_uq" UNIQUE("company_id","fingerprint_sha256"),
	CONSTRAINT "company_fiscal_certificates_status_chk" CHECK ("company_fiscal_certificates"."status" IN ('ACTIVE','REPLACED','DISABLED')),
	CONSTRAINT "company_fiscal_certificates_payload_chk" CHECK ("company_fiscal_certificates"."status" <> 'ACTIVE' OR "company_fiscal_certificates"."encrypted_payload" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "company_fiscal_certificate_events" ADD CONSTRAINT "company_fiscal_certificate_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fiscal_certificate_events" ADD CONSTRAINT "company_fiscal_certificate_events_certificate_id_company_fiscal_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."company_fiscal_certificates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fiscal_certificate_events" ADD CONSTRAINT "company_fiscal_certificate_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fiscal_certificates" ADD CONSTRAINT "company_fiscal_certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fiscal_certificates" ADD CONSTRAINT "company_fiscal_certificates_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_fiscal_certificate_events_company_idx" ON "company_fiscal_certificate_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_fiscal_certificates_one_active_uq" ON "company_fiscal_certificates" USING btree ("company_id") WHERE "company_fiscal_certificates"."status" = 'ACTIVE';