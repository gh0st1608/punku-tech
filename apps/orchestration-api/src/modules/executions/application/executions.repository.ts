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
  startIfPlanned(id: string, workspacePath: string, startedAt: Date): Promise<boolean>;
  workspacePath(id: string): Promise<string | null>;
  startTaskIfPending(executionId: string, taskId: string, startedAt: Date): Promise<boolean>;
  attachTaskSession(executionId: string, taskId: string, sessionId: string): Promise<boolean>;
  completeTask(
    executionId: string,
    taskId: string,
    finishedAt: Date,
    deliverables: { summary: string | null; artifactPaths: string[] },
  ): Promise<boolean>;
  failTaskAndExecution(executionId: string, taskId: string, finishedAt: Date): Promise<void>;
  completeExecutionIfTasksDone(executionId: string, finishedAt: Date): Promise<void>;
  failExecutionIfActive(executionId: string, finishedAt: Date): Promise<void>;
  listRunningExecutionIds(): Promise<string[]>;
  persistSessionEvent(event: OpenCodeSessionEvent): Promise<void>;
  failPlanningIfActive(id: string, finishedAt: Date): Promise<void>;
  cancelIfActive(id: string, finishedAt: Date): Promise<CancellationResult | null>;
  findEventCursor(executionId: string, eventId: string): Promise<EventCursor | null>;
  listEvents(id: string, cursor: EventCursor | null, limit: number): Promise<DomainEvent[]>;
  listUsage(id: string): Promise<UsageRecordForSummary[]>;
}
