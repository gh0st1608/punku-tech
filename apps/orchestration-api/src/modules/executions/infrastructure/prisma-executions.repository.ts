import { Injectable } from "@nestjs/common";
import { AgentId, agentIds, CreateExecutionRequest, DomainEvent, ExecutionDetails, ExecutionRecord, TaskRecord, UsageRecordForSummary } from "@aief/contracts";
import { ExecutionStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EventCursor, ExecutionsRepository } from "../application/executions.repository";

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function mapExecution(row: Prisma.ExecutionGetPayload<{}>): ExecutionRecord {
  return {
    id: row.id,
    name: row.name,
    requirement: row.requirement,
    status: row.status as ExecutionRecord["status"],
    budgetUsd: row.budgetUsd === null ? null : Number(row.budgetUsd),
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapTask(row: Prisma.TaskGetPayload<{}>): TaskRecord {
  const dependsOn = Array.isArray(row.dependsOn)
    ? row.dependsOn.filter((value): value is string => typeof value === "string")
    : [];

  return {
    id: row.id,
    agentId: row.agentId,
    title: row.title,
    description: row.description,
    status: row.status as TaskRecord["status"],
    dependsOn,
    sessionId: row.sessionId,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  };
}

function mapEvent(row: Prisma.EventGetPayload<{}>): DomainEvent {
  const payload = row.payload;
  const safePayload = payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : { value: payload };
  const event: DomainEvent = {
    eventId: row.id,
    executionId: row.executionId,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    source: row.source,
    schemaVersion: row.schemaVersion,
    payload: safePayload,
  };

  if (row.agentId && agentIds.includes(row.agentId as AgentId)) event.agentId = row.agentId as AgentId;
  if (row.taskId) event.taskId = row.taskId;
  if (row.sessionId) event.sessionId = row.sessionId;
  return event;
}

@Injectable()
export class PrismaExecutionsRepository implements ExecutionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateExecutionRequest): Promise<ExecutionRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const execution = await tx.execution.create({
        data: {
          name: input.name ?? input.requirement.slice(0, 80),
          requirement: input.requirement,
          budgetUsd: input.budgetUsd,
        },
      });
      await tx.event.create({
        data: {
          executionId: execution.id,
          eventType: "EXECUTION_CREATED",
          source: "orchestration-api",
          payload: { requestedBy: "local-user" },
        },
      });
      return execution;
    });

    return mapExecution(row);
  }

  async list(): Promise<ExecutionRecord[]> {
    const rows = await this.prisma.execution.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map(mapExecution);
  }

  async findDetails(id: string): Promise<ExecutionDetails | null> {
    const row = await this.prisma.execution.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { title: "asc" } },
        events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 500 },
      },
    });
    if (!row) return null;
    return { ...mapExecution(row), tasks: row.tasks.map(mapTask), events: row.events.map(mapEvent) };
  }

  async exists(id: string): Promise<boolean> {
    return (await this.prisma.execution.count({ where: { id } })) > 0;
  }

  async startIfCreated(id: string, startedAt: Date): Promise<ExecutionRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: { id, status: ExecutionStatus.CREATED },
        data: { status: ExecutionStatus.PLANNING, startedAt },
      });
      if (result.count === 0) return null;

      await tx.event.create({
        data: { executionId: id, eventType: "EXECUTION_PLANNING_REQUESTED", source: "orchestration-api", payload: {} },
      });
      return tx.execution.findUniqueOrThrow({ where: { id } });
    });

    return row ? mapExecution(row) : null;
  }

  async cancelIfActive(id: string, finishedAt: Date): Promise<ExecutionRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: {
          id,
          status: { notIn: [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED] },
        },
        data: { status: ExecutionStatus.CANCELLED, finishedAt },
      });
      if (result.count === 0) return null;

      await tx.event.create({
        data: { executionId: id, eventType: "EXECUTION_CANCELLED", source: "orchestration-api", payload: {} },
      });
      return tx.execution.findUniqueOrThrow({ where: { id } });
    });

    return row ? mapExecution(row) : null;
  }

  async findEventCursor(executionId: string, eventId: string): Promise<EventCursor | null> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, executionId },
      select: { id: true, occurredAt: true },
    });
    return event ? { eventId: event.id, occurredAt: event.occurredAt.toISOString() } : null;
  }

  async listEvents(id: string, cursor: EventCursor | null, limit: number): Promise<DomainEvent[]> {
    const where: Prisma.EventWhereInput = { executionId: id };
    if (cursor) {
      const occurredAt = new Date(cursor.occurredAt);
      where.OR = [
        { occurredAt: { gt: occurredAt } },
        { occurredAt, id: { gt: cursor.eventId } },
      ];
    }

    const rows = await this.prisma.event.findMany({
      where,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(mapEvent);
  }

  async listUsage(id: string): Promise<UsageRecordForSummary[]> {
    const rows = await this.prisma.usageRecord.findMany({ where: { executionId: id } });
    return rows.map((row) => ({
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      reportedCostUsd: row.reportedCostUsd === null ? null : Number(row.reportedCostUsd),
      estimatedCostUsd: row.estimatedCostUsd === null ? null : Number(row.estimatedCostUsd),
    }));
  }
}
