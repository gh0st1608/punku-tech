import {
  CreateExecutionRequest,
  DomainEvent,
  ExecutionDetails,
  ExecutionRecord,
  UsageRecordForSummary,
} from "@aief/contracts";

export const EXECUTIONS_REPOSITORY = Symbol("EXECUTIONS_REPOSITORY");

export interface EventCursor {
  occurredAt: string;
  eventId: string;
}

export interface ExecutionsRepository {
  create(input: CreateExecutionRequest): Promise<ExecutionRecord>;
  list(): Promise<ExecutionRecord[]>;
  findDetails(id: string): Promise<ExecutionDetails | null>;
  exists(id: string): Promise<boolean>;
  startIfCreated(id: string, startedAt: Date): Promise<ExecutionRecord | null>;
  cancelIfActive(id: string, finishedAt: Date): Promise<ExecutionRecord | null>;
  findEventCursor(executionId: string, eventId: string): Promise<EventCursor | null>;
  listEvents(id: string, cursor: EventCursor | null, limit: number): Promise<DomainEvent[]>;
  listUsage(id: string): Promise<UsageRecordForSummary[]>;
}
