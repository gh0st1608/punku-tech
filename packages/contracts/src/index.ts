export const executionStatuses = [
  "CREATED",
  "PLANNING",
  "PLANNED",
  "RUNNING",
  "VALIDATING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ExecutionStatus = (typeof executionStatuses)[number];

export const taskStatuses = [
  "PENDING",
  "RUNNING",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const agentIds = [
  "orchestrator",
  "backend",
  "frontend",
  "devops",
  "qa",
  "security",
  "documentation",
] as const;
export type AgentId = (typeof agentIds)[number];

export interface DomainEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  sourceEventId?: string;
  executionId: string;
  eventType: string;
  occurredAt: string;
  source: string;
  agentId?: AgentId;
  taskId?: string;
  sessionId?: string;
  schemaVersion: number;
  payload: TPayload;
}

export interface CreateExecutionRequest {
  name?: string;
  requirement: string;
  budgetUsd?: number;
}

export type CostStatus = "REPORTED" | "ESTIMATED" | "UNAVAILABLE";

export interface ExecutionRecord {
  id: string;
  name: string;
  requirement: string;
  status: ExecutionStatus;
  budgetUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  sequence: number;
  agentId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: TaskStatus;
  dependsOn: string[];
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PlannedTask {
  id: string;
  sequence: number;
  agentId: AgentId;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
}

export interface ExecutionDetails extends ExecutionRecord {
  tasks: TaskRecord[];
  events: DomainEvent[];
}

export interface UsageRecordForSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
}

export type UsageAvailability = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface UsageSummary {
  turns: number;
  tokenAvailability: UsageAvailability;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  unavailableUsageTurns: number;
  reportedCostUsd: number | null;
  reportedCostTurns: number;
  estimatedCostUsd: number | null;
  estimatedCostTurns: number;
  unavailableCostTurns: number;
}
