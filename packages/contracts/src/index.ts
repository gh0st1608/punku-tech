export const executionStatuses = [
  "CREATED",
  "PLANNING",
  "PLANNED",
  "RUNNING",
  "PAUSED_BUDGET",
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

export const projectStatuses = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const projectPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type ProjectPriority = (typeof projectPriorities)[number];

export interface ProjectRecord {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  status?: ProjectStatus;
  priority?: ProjectPriority;
}

export type UpdateProjectRequest = Partial<CreateProjectRequest>;

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

export interface ApproveExecutionBudgetRequest {
  newBudgetUsd: number;
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
  summary: string | null;
  artifactPaths: string[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskDetails extends TaskRecord {
  events: DomainEvent[];
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
  messageId: string;
  taskId: string | null;
  agentId: string | null;
  provider: string | null;
  model: string | null;
  recordedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  costStatus: CostStatus;
  rateVersion: string | null;
}

export type UsageAvailability = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type CostDisplayStatus = CostStatus | "MIXED";

export interface UsageBreakdown {
  key: string;
  label: string;
  turns: number;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reportedCostUsd: number | null;
  estimatedCostUsd: number | null;
  unavailableCostTurns: number;
  costStatus: CostDisplayStatus;
  rateVersions: string[];
}

export interface CompletedTaskModelCost {
  key: string;
  label: string;
  completedTasks: number;
  costUsd: number | null;
  costPerCompletedTaskUsd: number | null;
  unavailableCostTurns: number;
}

export interface UsageSummary {
  turns: number;
  tokenAvailability: UsageAvailability;
  costStatus: CostDisplayStatus;
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
  byAgent: UsageBreakdown[];
  byTask: UsageBreakdown[];
  byModel: UsageBreakdown[];
  completedTaskCostsByModel: CompletedTaskModelCost[];
}
