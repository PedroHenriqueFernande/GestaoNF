CREATE TABLE "invitation_request_limits" (
	"key" char(64) PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invitation_request_limits_started_idx" ON "invitation_request_limits" USING btree ("started_at");