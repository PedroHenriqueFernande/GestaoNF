CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"sale_id" uuid,
	"request_key" varchar(128) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"file_name" varchar(180) NOT NULL,
	"mime_type" varchar(40) NOT NULL,
	"expected_bytes" integer NOT NULL,
	"size_bytes" integer,
	"sha256" char(64),
	"width" integer,
	"height" integer,
	"page_count" integer,
	"bucket" varchar(63) NOT NULL,
	"staging_key" varchar(240) NOT NULL,
	"object_key" varchar(240) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"unattached_expires_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"staging_cleaned_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stored_files_company_id_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "stored_files_mime_chk" CHECK ("stored_files"."mime_type" IN ('image/jpeg', 'image/png', 'application/pdf')),
	CONSTRAINT "stored_files_status_chk" CHECK ("stored_files"."status" IN ('PENDING', 'READY', 'REJECTED', 'EXPIRED', 'DELETING', 'DELETED')),
	CONSTRAINT "stored_files_bytes_chk" CHECK ("stored_files"."expected_bytes" > 0 AND "stored_files"."expected_bytes" <= 26214400 AND ("stored_files"."size_bytes" IS NULL OR ("stored_files"."size_bytes" > 0 AND "stored_files"."size_bytes" <= 26214400))),
	CONSTRAINT "stored_files_ready_chk" CHECK ("stored_files"."status" <> 'READY' OR ("stored_files"."size_bytes" IS NOT NULL AND "stored_files"."sha256" IS NOT NULL AND "stored_files"."ready_at" IS NOT NULL AND "stored_files"."deleted_at" IS NULL AND "stored_files"."object_deleted_at" IS NULL)),
	CONSTRAINT "stored_files_filename_chk" CHECK (length(btrim("stored_files"."file_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_sale_company_fk" FOREIGN KEY ("company_id","sale_id") REFERENCES "public"."sales"("company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_command_uq" ON "stored_files" USING btree ("company_id","created_by_user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_staging_key_uq" ON "stored_files" USING btree ("staging_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stored_files_object_key_uq" ON "stored_files" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "stored_files_company_ready_idx" ON "stored_files" USING btree ("company_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "stored_files_staging_cleanup_idx" ON "stored_files" USING btree ("expires_at") WHERE "stored_files"."staging_cleaned_at" IS NULL;--> statement-breakpoint
CREATE INDEX "stored_files_delete_cleanup_idx" ON "stored_files" USING btree ("status") WHERE "stored_files"."status" = 'DELETING';--> statement-breakpoint
CREATE INDEX "stored_files_sale_idx" ON "stored_files" USING btree ("company_id","sale_id") WHERE "stored_files"."sale_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stored_files_unattached_cleanup_idx" ON "stored_files" USING btree ("unattached_expires_at") WHERE "stored_files"."status" = 'READY' AND "stored_files"."sale_id" IS NULL;