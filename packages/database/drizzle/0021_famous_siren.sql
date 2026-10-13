CREATE TABLE "account_subscriptions" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"plan_code" varchar(40) DEFAULT 'BASE' NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"additional_users_per_company" integer DEFAULT 5 NOT NULL,
	"current_period_ends_at" timestamp with time zone,
	"source" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_subscriptions_status_chk" CHECK ("account_subscriptions"."status" IN ('PENDING','ACTIVE','SUSPENDED','CANCELED')),
	CONSTRAINT "account_subscriptions_limit_chk" CHECK ("account_subscriptions"."additional_users_per_company" >= 0),
	CONSTRAINT "account_subscriptions_source_chk" CHECK ("account_subscriptions"."source" IN ('PENDING','LEGACY_DEV','BILLING','MANUAL')),
	CONSTRAINT "account_subscriptions_period_chk" CHECK ("account_subscriptions"."status" <> 'ACTIVE' OR "account_subscriptions"."source" = 'LEGACY_DEV' OR "account_subscriptions"."current_period_ends_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"request_key" varchar(200) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_owner_command_uq" UNIQUE("owner_user_id","request_key"),
	CONSTRAINT "accounts_status_chk" CHECK ("accounts"."status" IN ('PENDING','ACTIVE','SUSPENDED','CANCELED'))
);
--> statement-breakpoint
CREATE TABLE "user_invitation_companies" (
	"invitation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitation_companies_invitation_id_company_id_pk" PRIMARY KEY("invitation_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "user_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"invited_name" varchar(200) NOT NULL,
	"email_normalized" varchar(254) NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"resend_day" date,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "user_invitations_account_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "user_invitations_status_chk" CHECK ("user_invitations"."status" IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')),
	CONSTRAINT "user_invitations_email_chk" CHECK ("user_invitations"."email_normalized"=lower(btrim("user_invitations"."email_normalized"))),
	CONSTRAINT "user_invitations_accepted_chk" CHECK ("user_invitations"."status"<>'ACCEPTED' OR ("user_invitations"."accepted_by_user_id" IS NOT NULL AND "user_invitations"."accepted_at" IS NOT NULL)),
	CONSTRAINT "user_invitations_revoked_chk" CHECK ("user_invitations"."status"<>'REVOKED' OR "user_invitations"."revoked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "user_management_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"request_key" varchar(200) NOT NULL,
	"request_hash" char(64) NOT NULL,
	"operation" varchar(40) NOT NULL,
	"invitation_id" uuid,
	"result_user_id" uuid,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_management_commands_key_uq" UNIQUE("account_id","actor_user_id","request_key")
);
--> statement-breakpoint
CREATE TABLE "user_management_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"invitation_id" uuid,
	"company_id" uuid,
	"event_type" varchar(40) NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_messages" DROP CONSTRAINT "email_messages_send_status_chk";--> statement-breakpoint
ALTER TABLE "email_messages" ALTER COLUMN "text_body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ALTER COLUMN "html_body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT c.id FROM companies c LEFT JOIN company_users cu ON cu.company_id=c.id AND cu.role='OWNER' GROUP BY c.id HAVING count(cu.user_id) <> 1) THEN
    RAISE EXCEPTION 'Migração de usuários exige um único titular OWNER por empresa. Corrija o mapeamento antes de prosseguir.';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO accounts (owner_user_id, name, status, request_key, request_hash)
SELECT DISTINCT u.id, u.name, 'ACTIVE', 'legacy/' || u.id::text, repeat(md5(u.id::text),2)
FROM users u JOIN company_users cu ON cu.user_id=u.id AND cu.role='OWNER' JOIN companies c ON c.id=cu.company_id;--> statement-breakpoint
INSERT INTO account_subscriptions (account_id, status, source)
SELECT id, 'ACTIVE', 'LEGACY_DEV' FROM accounts;--> statement-breakpoint
UPDATE companies c SET account_id=a.id FROM company_users cu JOIN accounts a ON a.owner_user_id=cu.user_id WHERE cu.company_id=c.id AND cu.role='OWNER';--> statement-breakpoint
INSERT INTO user_management_events (account_id, actor_user_id, event_type, changes)
SELECT id, owner_user_id, 'LEGACY_ACCOUNT_MIGRATED', '{"source":"LEGACY_DEV"}'::jsonb FROM accounts;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_account_id_id_uq" UNIQUE("account_id","id");--> statement-breakpoint
ALTER TABLE "company_users" ADD COLUMN "joined_via_invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "company_users" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "company_users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "encrypted_payload" text;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "encryption_key_id" varchar(40);--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "invitation_version" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_subscriptions" ADD CONSTRAINT "account_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation_companies" ADD CONSTRAINT "user_invitation_companies_account_id_invitation_id_user_invitations_account_id_id_fk" FOREIGN KEY ("account_id","invitation_id") REFERENCES "public"."user_invitations"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitation_companies" ADD CONSTRAINT "user_invitation_companies_account_id_company_id_companies_account_id_id_fk" FOREIGN KEY ("account_id","company_id") REFERENCES "public"."companies"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_commands" ADD CONSTRAINT "user_management_commands_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_commands" ADD CONSTRAINT "user_management_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_commands" ADD CONSTRAINT "user_management_commands_result_user_id_users_id_fk" FOREIGN KEY ("result_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_commands" ADD CONSTRAINT "user_management_commands_account_id_invitation_id_user_invitations_account_id_id_fk" FOREIGN KEY ("account_id","invitation_id") REFERENCES "public"."user_invitations"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_events" ADD CONSTRAINT "user_management_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_events" ADD CONSTRAINT "user_management_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_events" ADD CONSTRAINT "user_management_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_events" ADD CONSTRAINT "user_management_events_account_id_invitation_id_user_invitations_account_id_id_fk" FOREIGN KEY ("account_id","invitation_id") REFERENCES "public"."user_invitations"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_management_events" ADD CONSTRAINT "user_management_events_account_id_company_id_companies_account_id_id_fk" FOREIGN KEY ("account_id","company_id") REFERENCES "public"."companies"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "user_invitation_companies_company_idx" ON "user_invitation_companies" USING btree ("company_id","invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_invitations_pending_email_uq" ON "user_invitations" USING btree ("account_id","email_normalized") WHERE "user_invitations"."status"='PENDING';--> statement-breakpoint
CREATE INDEX "user_invitations_account_idx" ON "user_invitations" USING btree ("account_id","status","created_at");--> statement-breakpoint
CREATE INDEX "user_invitations_expiry_idx" ON "user_invitations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "user_management_events_account_idx" ON "user_management_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "user_management_events_invitation_idx" ON "user_management_events" USING btree ("invitation_id","created_at");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_invitation_company_fk" FOREIGN KEY ("joined_via_invitation_id","company_id") REFERENCES "public"."user_invitation_companies"("invitation_id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_invitation_id_user_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."user_invitations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_content_chk" CHECK (("email_messages"."invitation_id" IS NULL AND "email_messages"."text_body" IS NOT NULL AND "email_messages"."html_body" IS NOT NULL AND "email_messages"."encrypted_payload" IS NULL) OR ("email_messages"."invitation_id" IS NOT NULL AND "email_messages"."text_body" IS NULL AND "email_messages"."html_body" IS NULL AND (("email_messages"."encrypted_payload" IS NOT NULL AND "email_messages"."encryption_key_id" IS NOT NULL) OR "email_messages"."send_status" IN ('ACCEPTED','FAILED','UNKNOWN','CANCELED'))));--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_invitation_chk" CHECK (("email_messages"."invitation_id" IS NULL) = ("email_messages"."invitation_version" IS NULL));--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_send_status_chk" CHECK ("email_messages"."send_status" IN ('QUEUED','SENDING','RETRYING','ACCEPTED','FAILED','UNKNOWN','CANCELED'));
