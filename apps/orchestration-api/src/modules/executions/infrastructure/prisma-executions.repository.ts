import { Inject, Injectable } from "@nestjs/common";
import type {
  AgentId,
  CreateExecutionRequest,
  DomainEvent,
  ExecutionDetails,
  ExecutionRecord,
  PlannedTask,
  TaskRecord,
  TaskDetails,
  UsageRecordForSummary,
} from "@aief/contracts";
import { agentIds } from "@aief/contracts";
import type { OpenCodeSessionEvent } from "../../opencode/application/opencode.gateway";
import type { Prisma } from "@prisma/client";
import { ExecutionStatus, TaskStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { evaluateBudget } from "../application/budget-policy";
import type { EventCursor, ExecutionsRepository } from "../application/executions.repository";

const EVENT_SOURCE = "orchestration-api";
const LOCAL_USER = "local-user";

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function mapExecution(
  row: Prisma.ExecutionGetPayload<Prisma.ExecutionDefaultArgs>,
): ExecutionRecord {
  return {
    id: row.id,
    name: row.name,
    requirement: row.requirement,
    status: row.status as ExecutionRecord["status"],
    budgetUsd: row.budgetUsd === null ? null : Number(row.budgetUsd),
    workspaceBranch: row.workspaceBranch,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapTask(row: Prisma.TaskGetPayload<Prisma.TaskDefaultArgs>): TaskRecord {
  const dependsOn = Array.isArray(row.dependsOn)
    ? row.dependsOn.filter((value): value is string => typeof value === "string")
    : [];
  const acceptanceCriteria = Array.isArray(row.acceptanceCriteria)
    ? row.acceptanceCriteria.filter((value): value is string => typeof value === "string")
    : [];
  const artifactPaths = Array.isArray(row.artifactPaths)
    ? row.artifactPaths.filter((value): value is string => typeof value === "string")
    : [];

  return {
    id: row.id,
    sequence: row.sequence,
    agentId: row.agentId,
    title: row.title,
    description: row.description,
    acceptanceCriteria,
    status: row.status as TaskRecord["status"],
    dependsOn,
    sessionId: row.sessionId,
    summary: row.summary,
    artifactPaths,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
  };
}

function mapEvent(row: Prisma.EventGetPayload<Prisma.EventDefaultArgs>): DomainEvent {
  const payload = row.payload;
  const safePayload =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
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

  if (row.externalEventId) event.sourceEventId = row.externalEventId;
  if (row.agentId && agentIds.includes(row.agentId as AgentId))
    event.agentId = row.agentId as AgentId;
  if (row.taskId) event.taskId = row.taskId;
  if (row.sessionId) event.sessionId = row.sessionId;
  return event;
}

@Injectable()
export class PrismaExecutionsRepository implements ExecutionsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
          source: EVENT_SOURCE,
          payload: { requestedBy: LOCAL_USER },
        },
      });
      return execution;
    });

    return mapExecution(row);
  }

  async list(): Promise<ExecutionRecord[]> {
    const rows = await this.prisma.execution.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(mapExecution);
  }

  async findDetails(id: string): Promise<ExecutionDetails | null> {
    const row = await this.prisma.execution.findUnique({
      where: { id },
      include: {
        tasks: { orderBy: { sequence: "asc" } },
        events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 500 },
      },
    });
    if (!row) return null;
    return {
      ...mapExecution(row),
      tasks: row.tasks.map(mapTask),
      events: row.events.map(mapEvent),
    };
  }

  async findTaskDetails(executionId: string, taskId: string): Promise<TaskDetails | null> {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, executionId } });
    if (!task) return null;
    const events = await this.prisma.event.findMany({
      where: { executionId, taskId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 500,
    });
    return { ...mapTask(task), events: events.map(mapEvent) };
  }

  async exists(id: string): Promise<boolean> {
    return (await this.prisma.execution.count({ where: { id } })) > 0;
  }

  async beginPlanningIfCreated(id: string, startedAt: Date): Promise<ExecutionRecord | null> {
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: { id, status: ExecutionStatus.CREATED },
        data: { status: ExecutionStatus.PLANNING, startedAt },
      });
      if (result.count === 0) return null;

      await tx.event.create({
        data: {
          executionId: id,
          eventType: "EXECUTION_PLANNING_REQUESTED",
          source: EVENT_SOURCE,
          payload: {},
        },
      });
      return tx.execution.findUniqueOrThrow({ where: { id } });
    });

    return row ? mapExecution(row) : null;
  }

  async persistPlan(
    id: string,
    tasks: PlannedTask[],
    sessionId: string,
  ): Promise<ExecutionDetails | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: { id, status: ExecutionStatus.PLANNING },
        data: { status: ExecutionStatus.PLANNED },
      });
      if (result.count === 0) return null;

      await tx.task.createMany({
        data: tasks.map((task) => ({
          id: task.id,
          executionId: id,
          sequence: task.sequence,
          agentId: task.agentId,
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
          dependsOn: task.dependsOn,
        })),
      });
      await tx.event.create({
        data: {
          executionId: id,
          eventType: "EXECUTION_PLAN_CREATED",
          source: EVENT_SOURCE,
          sessionId,
          payload: { taskCount: tasks.length, taskIds: tasks.map((task) => task.id) },
        },
      });

      const row = await tx.execution.findUniqueOrThrow({
        where: { id },
        include: {
          tasks: { orderBy: { sequence: "asc" } },
          events: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 500 },
        },
      });
      return {
        ...mapExecution(row),
        tasks: row.tasks.map(mapTask),
        events: row.events.map(mapEvent),
      };
    });
  }

  async startIfPlanned(
    id: string,
    claim: {
      workspacePath: string;
      workspaceBranch: string;
      runnerId: string;
      startedAt: Date;
      leaseUntil: Date;
    },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: { id, status: ExecutionStatus.PLANNED },
        data: {
          status: ExecutionStatus.RUNNING,
          startedAt: claim.startedAt,
          workspacePath: claim.workspacePath,
          workspaceBranch: claim.workspaceBranch,
          runnerId: claim.runnerId,
          runnerLeaseUntil: claim.leaseUntil,
        },
      });
      if (result.count === 0) return false;
      await tx.event.create({
        data: {
          executionId: id,
          eventType: "EXECUTION_STARTED",
          source: EVENT_SOURCE,
          payload: { taskCount: await tx.task.count({ where: { executionId: id } }) },
        },
      });
      return true;
    });
  }

  async claimRunningExecution(
    executionId: string,
    runnerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.prisma.execution.updateMany({
      where: {
        id: executionId,
        status: ExecutionStatus.RUNNING,
        OR: [{ runnerLeaseUntil: null }, { runnerLeaseUntil: { lt: now } }],
      },
      data: { runnerId, runnerLeaseUntil: leaseUntil },
    });
    return result.count > 0;
  }

  async renewExecutionLease(
    executionId: string,
    runnerId: string,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.prisma.execution.updateMany({
      where: { id: executionId, status: ExecutionStatus.RUNNING, runnerId },
      data: { runnerLeaseUntil: leaseUntil },
    });
    return result.count > 0;
  }

  async releaseExecutionLease(executionId: string, runnerId: string): Promise<void> {
    await this.prisma.execution.updateMany({
      where: { id: executionId, runnerId },
      data: { runnerId: null, runnerLeaseUntil: null },
    });
  }

  async workspacePath(id: string): Promise<string | null> {
    const row = await this.prisma.execution.findUnique({
      where: { id },
      select: { workspacePath: true },
    });
    return row?.workspacePath ?? null;
  }

  async startTaskIfPending(
    executionId: string,
    taskId: string,
    runnerId: string,
    startedAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: {
          id: taskId,
          executionId,
          status: TaskStatus.PENDING,
          execution: { status: ExecutionStatus.RUNNING, runnerId },
        },
        data: { status: TaskStatus.RUNNING, startedAt },
      });
      if (result.count === 0) return false;
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      await tx.event.create({
        data: {
          executionId,
          eventType: "TASK_STARTED",
          source: EVENT_SOURCE,
          taskId,
          agentId: task.agentId,
          payload: { sequence: task.sequence, title: task.title },
        },
      });
      return true;
    });
  }

  async attachTaskSession(
    executionId: string,
    taskId: string,
    runnerId: string,
    sessionId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: {
          id: taskId,
          executionId,
          status: TaskStatus.RUNNING,
          execution: { status: ExecutionStatus.RUNNING, runnerId },
        },
        data: { sessionId },
      });
      if (result.count === 0) return false;
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      await tx.event.create({
        data: {
          executionId,
          eventType: "TASK_SESSION_CREATED",
          source: EVENT_SOURCE,
          taskId,
          agentId: task.agentId,
          sessionId,
          payload: {},
        },
      });
      return true;
    });
  }

  async completeTask(
    executionId: string,
    taskId: string,
    completion: {
      runnerId: string;
      finishedAt: Date;
      deliverables: { summary: string | null; artifactPaths: string[] };
    },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: {
          id: taskId,
          executionId,
          status: TaskStatus.RUNNING,
          execution: { status: ExecutionStatus.RUNNING, runnerId: completion.runnerId },
        },
        data: {
          status: TaskStatus.COMPLETED,
          finishedAt: completion.finishedAt,
          summary: completion.deliverables.summary,
          artifactPaths: completion.deliverables.artifactPaths,
        },
      });
      if (result.count === 0) return false;
      const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
      await tx.event.create({
        data: {
          executionId,
          eventType: "TASK_COMPLETED",
          source: EVENT_SOURCE,
          taskId,
          agentId: task.agentId,
          sessionId: task.sessionId,
          payload: { artifactCount: completion.deliverables.artifactPaths.length },
        },
      });
      return true;
    });
  }

  async failTaskAndExecution(
    executionId: string,
    taskId: string,
    runnerId: string,
    finishedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({ where: { id: taskId, executionId } });
      if (!task) return;
      const failedExecution = await tx.execution.updateMany({
        where: { id: executionId, status: ExecutionStatus.RUNNING, runnerId },
        data: { status: ExecutionStatus.FAILED, finishedAt },
      });
      if (failedExecution.count === 0) return;
      await tx.task.updateMany({
        where: { id: taskId, executionId, status: TaskStatus.RUNNING },
        data: { status: TaskStatus.FAILED, finishedAt },
      });
      await tx.task.updateMany({
        where: { executionId, status: TaskStatus.PENDING },
        data: { status: TaskStatus.BLOCKED, finishedAt },
      });
      await tx.event.createMany({
        data: [
          {
            executionId,
            eventType: "TASK_FAILED",
            source: EVENT_SOURCE,
            taskId,
            agentId: task.agentId,
            sessionId: task.sessionId,
            payload: { failure: "agent_task_failed" },
          },
          {
            executionId,
            eventType: "EXECUTION_FAILED",
            source: EVENT_SOURCE,
            payload: { taskId, failure: "agent_task_failed" },
          },
        ],
      });
    });
  }

  async completeExecutionIfTasksDone(
    executionId: string,
    runnerId: string,
    finishedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const unfinishedCount = await tx.task.count({
        where: { executionId, status: { not: TaskStatus.COMPLETED } },
      });
      if (unfinishedCount !== 0) return;
      const result = await tx.execution.updateMany({
        where: { id: executionId, status: ExecutionStatus.RUNNING, runnerId },
        data: { status: ExecutionStatus.COMPLETED, finishedAt },
      });
      if (result.count === 0) return;
      await tx.event.create({
        data: {
          executionId,
          eventType: "EXECUTION_COMPLETED",
          source: EVENT_SOURCE,
          payload: {},
        },
      });
    });
  }

  async failExecutionIfActive(
    executionId: string,
    runnerId: string,
    finishedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const runningTasks = await tx.task.findMany({
        where: { executionId, status: TaskStatus.RUNNING },
        select: { id: true, sessionId: true, agentId: true },
      });
      const result = await tx.execution.updateMany({
        where: { id: executionId, status: ExecutionStatus.RUNNING, runnerId },
        data: { status: ExecutionStatus.FAILED, finishedAt },
      });
      if (result.count === 0) return;
      await tx.task.updateMany({
        where: { executionId, status: TaskStatus.PENDING },
        data: { status: TaskStatus.BLOCKED, finishedAt },
      });
      await tx.task.updateMany({
        where: { executionId, status: TaskStatus.RUNNING },
        data: { status: TaskStatus.FAILED, finishedAt },
      });
      await tx.event.createMany({
        data: [
          ...runningTasks.map((task) => ({
            executionId,
            eventType: "TASK_FAILED",
            source: EVENT_SOURCE,
            taskId: task.id,
            agentId: task.agentId,
            sessionId: task.sessionId,
            payload: { failure: "agent_task_failed" },
          })),
          {
            executionId,
            eventType: "EXECUTION_FAILED",
            source: EVENT_SOURCE,
            payload: { failure: "execution_runner_failed" },
          },
        ],
      });
    });
  }

  async listRunningExecutionIds(): Promise<string[]> {
    const rows = await this.prisma.execution.findMany({
      where: { status: ExecutionStatus.RUNNING },
      select: { id: true },
      orderBy: { startedAt: "asc" },
    });
    return rows.map((row) => row.id);
  }

  async enforceBudgetLimit(
    executionId: string,
    runnerId: string,
    spentUsd: number,
  ): Promise<"CONTINUE" | "PAUSED"> {
    return this.prisma.$transaction(async (tx) => {
      const execution = await tx.execution.findUnique({
        where: { id: executionId },
        select: { budgetUsd: true, status: true, runnerId: true },
      });
      if (
        !execution ||
        execution.status !== ExecutionStatus.RUNNING ||
        execution.runnerId !== runnerId
      )
        return "PAUSED";
      if (execution.budgetUsd === null) return "CONTINUE";

      const budgetUsd = Number(execution.budgetUsd);
      const decision = evaluateBudget(budgetUsd, spentUsd);
      if (decision === "PAUSE") {
        const paused = await tx.execution.updateMany({
          where: { id: executionId, status: ExecutionStatus.RUNNING, runnerId },
          data: {
            status: ExecutionStatus.PAUSED_BUDGET,
            runnerId: null,
            runnerLeaseUntil: null,
          },
        });
        if (paused.count > 0) {
          await tx.event.create({
            data: {
              executionId,
              eventType: "EXECUTION_BUDGET_PAUSED",
              source: EVENT_SOURCE,
              payload: { budgetUsd, spentUsd },
            },
          });
        }
        return "PAUSED";
      }

      if (decision === "WARN") {
        const warning = await tx.event.findFirst({
          where: { executionId, eventType: "EXECUTION_BUDGET_WARNING" },
          select: { id: true },
        });
        if (!warning) {
          await tx.event.create({
            data: {
              executionId,
              eventType: "EXECUTION_BUDGET_WARNING",
              source: EVENT_SOURCE,
              payload: { budgetUsd, spentUsd, thresholdPercent: 80 },
            },
          });
        }
      }
      return "CONTINUE";
    });
  }

  async approveBudget(executionId: string, newBudgetUsd: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const execution = await tx.execution.findUnique({
        where: { id: executionId },
        select: { budgetUsd: true },
      });
      if (
        execution?.budgetUsd === null ||
        !execution ||
        newBudgetUsd <= Number(execution.budgetUsd)
      )
        return false;

      const updated = await tx.execution.updateMany({
        where: { id: executionId, status: ExecutionStatus.PAUSED_BUDGET },
        data: { status: ExecutionStatus.RUNNING, budgetUsd: newBudgetUsd },
      });
      if (updated.count === 0) return false;
      await tx.event.create({
        data: {
          executionId,
          eventType: "EXECUTION_BUDGET_APPROVED",
          source: EVENT_SOURCE,
          payload: {
            previousBudgetUsd: Number(execution.budgetUsd),
            approvedBudgetUsd: newBudgetUsd,
          },
        },
      });
      return true;
    });
  }

  async persistSessionEvent(event: OpenCodeSessionEvent): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { sessionId: event.sessionId },
      select: { id: true, executionId: true, agentId: true },
    });
    if (!task) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.event.createMany({
        data: [
          {
            executionId: task.executionId,
            eventType: event.type,
            occurredAt: event.createdAt,
            source: "opencode",
            agentId: task.agentId,
            taskId: task.id,
            sessionId: event.sessionId,
            externalEventId: event.id,
            payload: {},
          },
        ],
        skipDuplicates: true,
      });

      if (!event.usage) return;
      const costStatus =
        event.usage.reportedCostUsd !== null
          ? "REPORTED"
          : event.usage.estimatedCostUsd !== null
            ? "ESTIMATED"
            : "UNAVAILABLE";
      await tx.usageRecord.createMany({
        data: [
          {
            executionId: task.executionId,
            taskId: task.id,
            agentId: task.agentId,
            sessionId: event.sessionId,
            messageId: event.usage.messageId,
            provider: event.usage.provider,
            model: event.usage.model,
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            reasoningTokens: event.usage.reasoningTokens,
            cacheReadTokens: event.usage.cacheReadTokens,
            cacheWriteTokens: event.usage.cacheWriteTokens,
            reportedCostUsd: event.usage.reportedCostUsd,
            estimatedCostUsd: event.usage.estimatedCostUsd,
            costStatus,
            rateVersion: event.usage.rateVersion,
            recordedAt: event.createdAt,
          },
        ],
        skipDuplicates: true,
      });
    });
  }

  async failPlanningIfActive(id: string, finishedAt: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: { id, status: ExecutionStatus.PLANNING },
        data: { status: ExecutionStatus.FAILED, finishedAt },
      });
      if (result.count === 0) return;

      await tx.event.create({
        data: {
          executionId: id,
          eventType: "EXECUTION_PLANNING_FAILED",
          source: EVENT_SOURCE,
          payload: { failure: "planning_failed" },
        },
      });
    });
  }

  async cancelIfActive(id: string, finishedAt: Date) {
    const row = await this.prisma.$transaction(async (tx) => {
      const result = await tx.execution.updateMany({
        where: {
          id,
          status: {
            notIn: [ExecutionStatus.COMPLETED, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED],
          },
        },
        data: {
          status: ExecutionStatus.CANCELLED,
          finishedAt,
          runnerId: null,
          runnerLeaseUntil: null,
        },
      });
      if (result.count === 0) return null;

      const sessions = await tx.task.findMany({
        where: { executionId: id, status: TaskStatus.RUNNING, sessionId: { not: null } },
        select: { id: true, sessionId: true, agentId: true },
      });
      await tx.task.updateMany({
        where: {
          executionId: id,
          status: { in: [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.BLOCKED] },
        },
        data: { status: TaskStatus.CANCELLED, finishedAt },
      });
      if (sessions.length) {
        await tx.event.createMany({
          data: sessions.map((task) => ({
            executionId: id,
            eventType: "TASK_CANCELLED",
            source: EVENT_SOURCE,
            taskId: task.id,
            agentId: task.agentId,
            sessionId: task.sessionId,
            payload: {},
          })),
        });
      }

      await tx.event.create({
        data: {
          executionId: id,
          eventType: "EXECUTION_CANCELLED",
          source: EVENT_SOURCE,
          payload: {},
        },
      });
      return { execution: await tx.execution.findUniqueOrThrow({ where: { id } }), sessions };
    });

    return row
      ? {
          execution: mapExecution(row.execution),
          sessionIds: row.sessions.flatMap((task) => (task.sessionId ? [task.sessionId] : [])),
        }
      : null;
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
      where.OR = [{ occurredAt: { gt: occurredAt } }, { occurredAt, id: { gt: cursor.eventId } }];
    }

    const rows = await this.prisma.event.findMany({
      where,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return rows.map(mapEvent);
  }

  async listUsage(id: string): Promise<UsageRecordForSummary[]> {
    const rows = await this.prisma.usageRecord.findMany({
      where: { executionId: id },
      orderBy: [{ recordedAt: "asc" }, { messageId: "asc" }],
    });
    return rows.map((row) => ({
      messageId: row.messageId,
      taskId: row.taskId,
      agentId: row.agentId,
      provider: row.provider,
      model: row.model,
      recordedAt: row.recordedAt.toISOString(),
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      reasoningTokens: row.reasoningTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      reportedCostUsd: row.reportedCostUsd === null ? null : Number(row.reportedCostUsd),
      estimatedCostUsd: row.estimatedCostUsd === null ? null : Number(row.estimatedCostUsd),
      costStatus: row.costStatus as UsageRecordForSummary["costStatus"],
      rateVersion: row.rateVersion,
    }));
  }
}
