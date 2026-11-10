CREATE TABLE "user_avatar_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_key" varchar(200) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"input_mime_type" varchar(32) NOT NULL,
	"expected_bytes" integer NOT NULL,
	"mime_type" varchar(32),
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"sha256" char(64),
	"bucket" text NOT NULL,
	"staging_key" text NOT NULL,
	"object_key" text NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"unattached_expires_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"staging_cleaned_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatar_files_user_id_id_uq" UNIQUE("user_id","id"),
	CONSTRAINT "user_avatar_files_request_uq" UNIQUE("user_id","request_key"),
	CONSTRAINT "user_avatar_files_staging_key_uq" UNIQUE("staging_key"),
	CONSTRAINT "user_avatar_files_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "user_avatar_files_status_chk" CHECK ("user_avatar_files"."status" IN ('PENDING','READY','ACTIVE','REJECTED','EXPIRED','DELETING','DELETED')),
	CONSTRAINT "user_avatar_files_input_chk" CHECK ("user_avatar_files"."input_mime_type" IN ('image/jpeg','image/png','image/webp') AND "user_avatar_files"."expected_bytes" BETWEEN 1 AND 5242880),
	CONSTRAINT "user_avatar_files_ready_chk" CHECK ("user_avatar_files"."status" NOT IN ('READY','ACTIVE') OR ("user_avatar_files"."mime_type" IS NOT NULL AND "user_avatar_files"."size_bytes" IS NOT NULL AND "user_avatar_files"."width" IS NOT NULL AND "user_avatar_files"."height" IS NOT NULL AND "user_avatar_files"."mime_type" = 'image/webp' AND "user_avatar_files"."size_bytes" BETWEEN 1 AND 1048576 AND "user_avatar_files"."width" BETWEEN 1 AND 512 AND "user_avatar_files"."height" BETWEEN 1 AND 512 AND "user_avatar_files"."sha256" IS NOT NULL AND "user_avatar_files"."ready_at" IS NOT NULL AND "user_avatar_files"."object_deleted_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_avatar_files" ADD CONSTRAINT "user_avatar_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_avatar_files_active_user_uq" ON "user_avatar_files" USING btree ("user_id") WHERE "user_avatar_files"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "user_avatar_files_user_status_idx" ON "user_avatar_files" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_avatar_files_upload_expiry_idx" ON "user_avatar_files" USING btree ("upload_expires_at");--> statement-breakpoint
CREATE INDEX "user_avatar_files_unattached_expiry_idx" ON "user_avatar_files" USING btree ("unattached_expires_at");--> statement-breakpoint
CREATE INDEX "user_avatar_files_cleanup_idx" ON "user_avatar_files" USING btree ("status","staging_cleaned_at","object_deleted_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_owner_fk" FOREIGN KEY ("id","avatar_id") REFERENCES "public"."user_avatar_files"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_name_trimmed_chk" CHECK ("users"."name" = btrim("users"."name"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_profile_version_chk" CHECK ("users"."profile_version" > 0);
