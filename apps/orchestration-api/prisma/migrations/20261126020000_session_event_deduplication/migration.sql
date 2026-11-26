ALTER TABLE "events" ADD COLUMN "external_event_id" TEXT;

CREATE UNIQUE INDEX "events_external_event_id_key" ON "events"("external_event_id");

CREATE INDEX "events_session_id_idx" ON "events"("session_id");
