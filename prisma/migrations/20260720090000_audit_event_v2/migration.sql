-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM (
  'AUTHENTICATION',
  'ADMINISTRATION',
  'DATA_CHANGE',
  'APPROVAL',
  'OUTPUT',
  'MACHINE',
  'SYSTEM'
);

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('WEB', 'CLI', 'SYSTEM');

-- AlterTable
ALTER TABLE "AuditEvent"
  ADD COLUMN "category" "AuditCategory",
  ADD COLUMN "outcome" "AuditOutcome",
  ADD COLUMN "source" "AuditSource",
  ADD COLUMN "schemaVersion" SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN "actorDisplayName" VARCHAR(100),
  ADD COLUMN "actorEmail" VARCHAR(320),
  ADD COLUMN "subjectFingerprint" CHAR(64),
  ADD COLUMN "sourceFingerprint" CHAR(64),
  ADD COLUMN "before" JSONB,
  ADD COLUMN "after" JSONB;

-- Existing rows remain version 1 and retain their original metadata.
UPDATE "AuditEvent"
SET
  "schemaVersion" = 1,
  "category" = CASE
    WHEN "action" LIKE 'auth.%' THEN 'AUTHENTICATION'::"AuditCategory"
    WHEN "action" LIKE 'admin.%' OR "action" LIKE 'audit.%' THEN 'ADMINISTRATION'::"AuditCategory"
    ELSE 'SYSTEM'::"AuditCategory"
  END,
  "outcome" = CASE
    WHEN "action" = 'auth.login_failed' THEN 'DENIED'::"AuditOutcome"
    ELSE 'SUCCESS'::"AuditOutcome"
  END,
  "source" = CASE
    WHEN "action" IN ('auth.admin_bootstrapped', 'auth.password_reset_issued')
      THEN 'CLI'::"AuditSource"
    WHEN "action" LIKE 'platform.%' THEN 'SYSTEM'::"AuditSource"
    ELSE 'WEB'::"AuditSource"
  END;

UPDATE "AuditEvent" AS audit
SET
  "actorDisplayName" = actor."displayName",
  "actorEmail" = actor."email"
FROM "User" AS actor
WHERE audit."actorUserId" = actor."id";

ALTER TABLE "AuditEvent"
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "outcome" SET NOT NULL,
  ALTER COLUMN "source" SET NOT NULL;

-- Replace lookup indexes with stable occurredAt + id cursor indexes.
DROP INDEX "AuditEvent_organizationId_occurredAt_idx";
DROP INDEX "AuditEvent_organizationId_entityType_entityId_occurredAt_idx";
DROP INDEX "AuditEvent_actorUserId_occurredAt_idx";

CREATE INDEX "AuditEvent_organizationId_occurredAt_id_idx"
  ON "AuditEvent"("organizationId", "occurredAt", "id");
CREATE INDEX "AuditEvent_organizationId_category_occurredAt_id_idx"
  ON "AuditEvent"("organizationId", "category", "occurredAt", "id");
CREATE INDEX "AuditEvent_organizationId_action_occurredAt_id_idx"
  ON "AuditEvent"("organizationId", "action", "occurredAt", "id");
CREATE INDEX "AuditEvent_organizationId_actorUserId_occurredAt_id_idx"
  ON "AuditEvent"("organizationId", "actorUserId", "occurredAt", "id");
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_occurredAt_id_idx"
  ON "AuditEvent"("organizationId", "entityType", "entityId", "occurredAt", "id");

-- Audit events are append-only. Schema migrations may replace this trigger,
-- while normal application statements cannot update or delete rows.
CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW
EXECUTE FUNCTION reject_audit_event_mutation();

-- Local, CI, and production installations use this role when present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fold_web_app') THEN
    REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM fold_web_app;
  END IF;
END;
$$;
