DO $$
BEGIN
  LOCK TABLE "crm_lead_entries", "crm_opportunities" IN ACCESS EXCLUSIVE MODE;

  -- Preserve earlier interests in the history of their original negotiation.
  INSERT INTO "crm_activities" (
    "company_id", "contact_id", "opportunity_id", "entry_id", "kind", "actor_type", "note", "occurred_at", "recorded_at"
  )
  SELECT e."company_id", e."contact_id", o."id", e."id", 'NOTE_ADDED', 'SYSTEM', e."interest_description", e."occurred_at", e."received_at"
  FROM "crm_lead_entries" e
  LEFT JOIN "crm_opportunities" o ON o."company_id" = e."company_id" AND o."contact_id" = e."contact_id" AND o."origin_entry_id" = e."id"
  WHERE NULLIF(btrim(e."interest_description"), '') IS NOT NULL;

  ALTER TABLE "crm_lead_entries" DROP COLUMN "interest_description";
  ALTER TABLE "crm_opportunities"
    DROP CONSTRAINT "crm_opportunities_amount_chk",
    DROP COLUMN "estimated_amount",
    DROP COLUMN "expected_close_on";
END $$;
