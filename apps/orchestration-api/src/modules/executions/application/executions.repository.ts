import type {
  CreateExecutionRequest,
  DomainEvent,
  ExecutionDetails,
  ExecutionRecord,
  PlannedTask,
  TaskDetails,
  UsageRecordForSummary,
} from "@aief/contracts";
import type { OpenCodeSessionEvent } from "../../opencode/application/opencode.gateway";

export const EXECUTIONS_REPOSITORY = Symbol("EXECUTIONS_REPOSITORY");

export interface EventCursor {
  occurredAt: string;
  eventId: string;
}

export interface CancellationResult {
  execution: ExecutionRecord;
  sessionIds: string[];
}

export interface ExecutionsRepository {
  create(input: CreateExecutionRequest): Promise<ExecutionRecord>;
  list(): Promise<ExecutionRecord[]>;
  findDetails(id: string): Promise<ExecutionDetails | null>;
  findTaskDetails(executionId: string, taskId: string): Promise<TaskDetails | null>;
  exists(id: string): Promise<boolean>;
  beginPlanningIfCreated(id: string, startedAt: Date): Promise<ExecutionRecord | null>;
  persistPlan(
    id: string,
    tasks: PlannedTask[],
    sessionId: string,
  ): Promise<ExecutionDetails | null>;
  startIfPlanned(
    id: string,
    claim: { workspacePath: string; runnerId: string; startedAt: Date; leaseUntil: Date },
  ): Promise<boolean>;
  claimRunningExecution(
    executionId: string,
    runnerId: string,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean>;
  renewExecutionLease(executionId: string, runnerId: string, leaseUntil: Date): Promise<boolean>;
  releaseExecutionLease(executionId: string, runnerId: string): Promise<void>;
  workspacePath(id: string): Promise<string | null>;
  startTaskIfPending(
    executionId: string,
    taskId: string,
    runnerId: string,
    startedAt: Date,
  ): Promise<boolean>;
  attachTaskSession(
    executionId: string,
    taskId: string,
    runnerId: string,
    sessionId: string,
  ): Promise<boolean>;
  completeTask(
    executionId: string,
    taskId: string,
    completion: {
      runnerId: string;
      finishedAt: Date;
      deliverables: { summary: string | null; artifactPaths: string[] };
    },
  ): Promise<boolean>;
  failTaskAndExecution(
    executionId: string,
    taskId: string,
    runnerId: string,
    finishedAt: Date,
  ): Promise<void>;
  completeExecutionIfTasksDone(
    executionId: string,
    runnerId: string,
    finishedAt: Date,
  ): Promise<void>;
  failExecutionIfActive(executionId: string, runnerId: string, finishedAt: Date): Promise<void>;
  listRunningExecutionIds(): Promise<string[]>;
  enforceBudgetLimit(
    executionId: string,
    runnerId: string,
    spentUsd: number,
  ): Promise<"CONTINUE" | "PAUSED">;
  approveBudget(executionId: string, newBudgetUsd: number): Promise<boolean>;
  persistSessionEvent(event: OpenCodeSessionEvent): Promise<void>;
  failPlanningIfActive(id: string, finishedAt: Date): Promise<void>;
  cancelIfActive(id: string, finishedAt: Date): Promise<CancellationResult | null>;
  findEventCursor(executionId: string, eventId: string): Promise<EventCursor | null>;
  listEvents(id: string, cursor: EventCursor | null, limit: number): Promise<DomainEvent[]>;
  listUsage(id: string): Promise<UsageRecordForSummary[]>;
}
