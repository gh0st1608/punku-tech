ALTER TABLE "executions"
ADD COLUMN "runner_id" TEXT,
ADD COLUMN "runner_lease_until" TIMESTAMP(3);

CREATE INDEX "executions_status_runner_lease_until_idx"
ON "executions"("status", "runner_lease_until");
