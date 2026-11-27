-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('CREATED', 'PLANNING', 'PLANNED', 'RUNNING', 'VALIDATING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "executions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'CREATED',
    "budget_usd" DECIMAL(12,6),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "agent_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "acceptance_criteria_json" JSONB NOT NULL DEFAULT '[]',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "depends_on_json" JSONB NOT NULL DEFAULT '[]',
    "session_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "agent_id" TEXT,
    "task_id" UUID,
    "session_id" TEXT,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "schema_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "execution_id" UUID NOT NULL,
    "task_id" UUID,
    "agent_id" TEXT,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "reasoning_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "cache_write_tokens" INTEGER,
    "reported_cost_usd" DECIMAL(12,8),
    "estimated_cost_usd" DECIMAL(12,8),
    "cost_status" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "rate_version" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_execution_id_status_idx" ON "tasks"("execution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_execution_id_sequence_key" ON "tasks"("execution_id", "sequence");

-- CreateIndex
CREATE INDEX "events_execution_id_occurred_at_idx" ON "events"("execution_id", "occurred_at");

-- CreateIndex
CREATE INDEX "usage_records_execution_id_task_id_idx" ON "usage_records"("execution_id", "task_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_session_id_message_id_key" ON "usage_records"("session_id", "message_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

