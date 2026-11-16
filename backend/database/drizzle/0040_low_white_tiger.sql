CREATE TABLE "company_logo_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"request_key" varchar(200) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"input_mime_type" varchar(32) NOT NULL,
	"expected_bytes" integer NOT NULL,
	"mime_type" varchar(32),
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"sha256" char(64),
	"thumb_size_bytes" integer,
	"thumb_width" integer,
	"thumb_height" integer,
	"bucket" text NOT NULL,
	"staging_key" text NOT NULL,
	"object_key" text NOT NULL,
	"thumb_object_key" text NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"unattached_expires_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"staging_cleaned_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_logo_files_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "company_logo_files_request_uq" UNIQUE("company_id","created_by_user_id","request_key"),
	CONSTRAINT "company_logo_files_staging_key_uq" UNIQUE("staging_key"),
	CONSTRAINT "company_logo_files_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "company_logo_files_thumb_object_key_uq" UNIQUE("thumb_object_key"),
	CONSTRAINT "company_logo_files_status_chk" CHECK ("company_logo_files"."status" IN ('PENDING','READY','ACTIVE','REJECTED','EXPIRED','DELETING','DELETED')),
	CONSTRAINT "company_logo_files_input_chk" CHECK ("company_logo_files"."input_mime_type" IN ('image/jpeg','image/png','image/webp') AND "company_logo_files"."expected_bytes" BETWEEN 1 AND 5242880),
	CONSTRAINT "company_logo_files_ready_chk" CHECK ("company_logo_files"."status" NOT IN ('READY','ACTIVE') OR ("company_logo_files"."mime_type" IS NOT NULL AND "company_logo_files"."size_bytes" IS NOT NULL AND "company_logo_files"."width" IS NOT NULL AND "company_logo_files"."height" IS NOT NULL AND "company_logo_files"."thumb_size_bytes" IS NOT NULL AND "company_logo_files"."thumb_width" IS NOT NULL AND "company_logo_files"."thumb_height" IS NOT NULL AND "company_logo_files"."mime_type" = 'image/webp' AND "company_logo_files"."size_bytes" BETWEEN 1 AND 2097152 AND "company_logo_files"."width" BETWEEN 1 AND 1080 AND "company_logo_files"."height" BETWEEN 1 AND 1080 AND "company_logo_files"."sha256" IS NOT NULL AND "company_logo_files"."thumb_size_bytes" BETWEEN 1 AND 131072 AND "company_logo_files"."thumb_width" = 128 AND "company_logo_files"."thumb_height" = 128 AND "company_logo_files"."ready_at" IS NOT NULL AND "company_logo_files"."object_deleted_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "logo_id" uuid;--> statement-breakpoint
ALTER TABLE "company_logo_files" ADD CONSTRAINT "company_logo_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_logo_files" ADD CONSTRAINT "company_logo_files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_logo_files_active_company_uq" ON "company_logo_files" USING btree ("company_id") WHERE "company_logo_files"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "company_logo_files_company_status_idx" ON "company_logo_files" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "company_logo_files_upload_expiry_idx" ON "company_logo_files" USING btree ("upload_expires_at");--> statement-breakpoint
CREATE INDEX "company_logo_files_unattached_expiry_idx" ON "company_logo_files" USING btree ("unattached_expires_at");--> statement-breakpoint
CREATE INDEX "company_logo_files_cleanup_idx" ON "company_logo_files" USING btree ("status","staging_cleaned_at","object_deleted_at");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_logo_owner_fk" FOREIGN KEY ("id","logo_id") REFERENCES "public"."company_logo_files"("company_id","id") ON DELETE restrict ON UPDATE no action;