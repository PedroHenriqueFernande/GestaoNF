UPDATE "whatsapp_outbound_messages" AS m
SET "status" = 'FAILED', "failed_at" = now(), "updated_at" = now(),
    "failure_reason" = COALESCE(m."failure_reason", 'Tentativas de envio esgotadas')
WHERE m."status" IN ('QUEUED', 'SENDING')
  AND (SELECT count(*) FROM "whatsapp_send_attempts" a WHERE a."outbound_message_id" = m."id") >= 6;
--> statement-breakpoint
WITH "failed_outbox" AS (
  UPDATE "integration_outbox"
  SET "state" = 'FAILED', "last_error" = 'Saneamento: job esgotado na fila'
  WHERE "topic" IN ('whatsapp.inbound', 'whatsapp.outbound')
    AND "state" = 'PUBLISHED' AND "completed_at" IS NULL AND "attempts" >= 10
  RETURNING "payload", "topic"
)
UPDATE "whatsapp_outbound_messages" AS m
SET "status" = 'FAILED', "failed_at" = now(), "updated_at" = now(),
    "failure_reason" = COALESCE(m."failure_reason", 'Tentativas de envio esgotadas')
FROM "failed_outbox" AS f
WHERE f."topic" = 'whatsapp.outbound'
  AND m."id" = (f."payload"->>'outboundMessageId')::uuid
  AND m."status" IN ('QUEUED', 'SENDING');
