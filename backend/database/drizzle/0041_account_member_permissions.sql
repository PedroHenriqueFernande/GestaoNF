CREATE TABLE "account_members" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_label" varchar(20) NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_pk" PRIMARY KEY("account_id","user_id"),
	CONSTRAINT "account_members_role_label_chk" CHECK ("account_members"."role_label" IN ('OWNER','MANAGER','COLLABORATOR')),
	CONSTRAINT "account_members_permissions_chk" CHECK ("account_members"."permissions" <@ ARRAY['sales.access','sales.create','sales.edit','sales.delete','sales.change_price','sales.nfse_issue','sales.nfse_cancel','sales.nfse_edit','sales.attachments_view','finance.access','finance.receive','finance.reverse','finance.edit_dates','crm.access','crm.create','crm.edit','crm.archive','crm.assign','agenda.access','agenda.manage','agenda.settings','proposals.access','proposals.manage','proposals.change_price','proposals.convert','proposals.settings','reports.access','reports.export','customers.access','customers.create','customers.edit','customers.deactivate','customers.export','services.access','services.create','services.edit','services.edit_price','services.deactivate','company.access','company.edit','company.certificate','fiscal.series','fiscal.tax','nero.use','support.assistant']::text[])
);
--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "role_label" varchar(20) DEFAULT 'COLLABORATOR' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_role_label_chk" CHECK ("user_invitations"."role_label" IN ('OWNER','MANAGER','COLLABORATOR'));--> statement-breakpoint
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_permissions_chk" CHECK ("user_invitations"."permissions" <@ ARRAY['sales.access','sales.create','sales.edit','sales.delete','sales.change_price','sales.nfse_issue','sales.nfse_cancel','sales.nfse_edit','sales.attachments_view','finance.access','finance.receive','finance.reverse','finance.edit_dates','crm.access','crm.create','crm.edit','crm.archive','crm.assign','agenda.access','agenda.manage','agenda.settings','proposals.access','proposals.manage','proposals.change_price','proposals.convert','proposals.settings','reports.access','reports.export','customers.access','customers.create','customers.edit','customers.deactivate','customers.export','services.access','services.create','services.edit','services.edit_price','services.deactivate','company.access','company.edit','company.certificate','fiscal.series','fiscal.tax','nero.use','support.assistant']::text[]);
--> statement-breakpoint
-- Backfill (Spec 6.1). Conjuntos congelados; espelhados em backend/tests/permission-fixtures.ts e verificados por permissions-migration.test.ts.
WITH legacy AS (
  SELECT c.account_id, cu.user_id,
         bool_or(cu.role = 'OWNER') AS has_owner,
         bool_or(cu.role = 'ADMIN') AS has_admin,
         bool_or(cu.role = 'MANAGER') AS has_manager
  FROM company_users cu
  JOIN companies c ON c.id = cu.company_id
  JOIN accounts a ON a.id = c.account_id
  WHERE cu.user_id <> a.owner_user_id
  GROUP BY c.account_id, cu.user_id
), mapped AS (
  SELECT account_id, user_id,
         CASE WHEN has_owner THEN 'OWNER' WHEN has_admin OR has_manager THEN 'MANAGER' ELSE 'COLLABORATOR' END AS role_label,
         CASE
           WHEN has_owner OR has_admin THEN ARRAY[
             'sales.access', 'sales.create', 'sales.edit', 'sales.delete', 'sales.change_price',
             'sales.nfse_issue', 'sales.nfse_cancel', 'sales.nfse_edit', 'sales.attachments_view', 'finance.access',
             'finance.receive', 'finance.reverse', 'finance.edit_dates', 'crm.access', 'crm.create',
             'crm.edit', 'crm.archive', 'crm.assign', 'agenda.access', 'agenda.manage',
             'agenda.settings', 'proposals.access', 'proposals.manage', 'proposals.change_price', 'proposals.convert',
             'proposals.settings', 'reports.access', 'reports.export', 'customers.access', 'customers.create',
             'customers.edit', 'customers.deactivate', 'customers.export', 'services.access', 'services.create',
             'services.edit', 'services.edit_price', 'services.deactivate', 'company.access', 'company.edit',
             'company.certificate', 'fiscal.series', 'fiscal.tax', 'nero.use', 'support.assistant'
           ]::text[]
           WHEN has_manager THEN ARRAY[
             'sales.access', 'sales.create', 'sales.edit', 'sales.delete', 'sales.change_price',
             'sales.attachments_view', 'finance.access', 'finance.receive', 'finance.reverse', 'finance.edit_dates',
             'crm.access', 'crm.create', 'crm.edit', 'crm.archive', 'crm.assign',
             'agenda.access', 'agenda.manage', 'agenda.settings', 'proposals.access', 'proposals.manage',
             'proposals.change_price', 'proposals.convert', 'proposals.settings', 'reports.access', 'reports.export',
             'customers.access', 'customers.create', 'customers.edit', 'customers.deactivate', 'customers.export',
             'services.access', 'services.create', 'services.edit', 'services.edit_price', 'services.deactivate',
             'company.access', 'nero.use', 'support.assistant'
           ]::text[]
           ELSE ARRAY[
             'sales.access', 'sales.create', 'sales.edit', 'sales.delete', 'sales.change_price',
             'sales.attachments_view', 'finance.access', 'finance.receive', 'finance.reverse', 'finance.edit_dates',
             'crm.access', 'crm.create', 'crm.edit', 'agenda.access', 'agenda.manage',
             'proposals.access', 'proposals.manage', 'proposals.change_price', 'proposals.convert', 'reports.access',
             'reports.export', 'customers.access', 'customers.create', 'customers.edit', 'customers.deactivate',
             'customers.export', 'services.access', 'services.create', 'services.edit', 'services.edit_price',
             'services.deactivate', 'company.access', 'nero.use', 'support.assistant'
           ]::text[]
         END AS permissions
  FROM legacy
), inserted AS (
  INSERT INTO account_members (account_id, user_id, role_label, permissions)
  SELECT account_id, user_id, role_label, permissions FROM mapped
  ON CONFLICT (account_id, user_id) DO NOTHING
  RETURNING account_id, user_id, role_label, permissions
)
INSERT INTO user_management_events (account_id, actor_user_id, target_user_id, event_type, changes)
SELECT account_id, NULL, user_id, 'PERMISSIONS_MIGRATED',
       jsonb_build_object('source', 'legacy_role', 'roleLabel', role_label, 'permissions', to_jsonb(permissions))
FROM inserted;
