import { randomUUID } from "node:crypto";
import type {
  CreateExecutionRequest,
  DomainEvent,
  ExecutionDetails,
  ExecutionRecord,
  PlannedTask,
  UsageSummary,
} from "@aief/contracts";
import { agentIds } from "@aief/contracts";
import type { AppEnvironment } from "../../../config/app-environment";
import { OpenCodeUnavailableError } from "../../opencode/application/opencode-unavailable.error";
import type { OpenCodeGateway } from "../../opencode/application/opencode.gateway";
import { ExecutionNotFoundError } from "./execution-not-found.error";
import { ExecutionPlanInvalidError } from "./execution-plan-invalid.error";
import { ExecutionPlanningConflictError } from "./execution-planning-conflict.error";
import type { EventCursor, ExecutionsRepository } from "./executions.repository";
import { summarizeUsage } from "./usage-summary";

type PlanDraftTask = {
  key: string;
  agentId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, minLength: number, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length < minLength || value.length > maxLength) {
    throw new ExecutionPlanInvalidError();
  }
  return value.trim();
}

function readKey(value: unknown): string {
  const key = readText(value, 1, 40);
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new ExecutionPlanInvalidError();
  return key;
}

function readTextList(
  value: unknown,
  minItems: number,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new ExecutionPlanInvalidError();
  }
  return value.map((item) => readText(item, 1, maxLength));
}

function readDraftTask(candidate: unknown, availableAgentIds: Set<string>): PlanDraftTask {
  if (!isRecord(candidate)) throw new ExecutionPlanInvalidError();
  const key = readKey(candidate.key);
  const agentId = readText(candidate.agentId, 1, 64);
  if (!agentIds.includes(agentId as (typeof agentIds)[number]) || !availableAgentIds.has(agentId)) {
    throw new ExecutionPlanInvalidError();
  }
  return {
    key,
    agentId,
    title: readText(candidate.title, 3, 180),
    description: readText(candidate.description, 10, 4000),
    acceptanceCriteria: readTextList(candidate.acceptanceCriteria, 1, 8, 500),
    dependsOn: readTextList(candidate.dependsOn, 0, 12, 40).map(readKey),
  };
}

function assertValidDependencies(tasks: PlanDraftTask[]): void {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  if (byKey.size !== tasks.length) throw new ExecutionPlanInvalidError();
  for (const task of tasks) {
    if (
      new Set(task.dependsOn).size !== task.dependsOn.length ||
      task.dependsOn.includes(task.key) ||
      task.dependsOn.some((key) => !byKey.has(key))
    ) {
      throw new ExecutionPlanInvalidError();
    }
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) throw new ExecutionPlanInvalidError();
    if (visited.has(key)) return;
    active.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) visit(dependency);
    active.delete(key);
    visited.add(key);
  };
  for (const task of tasks) visit(task.key);
}

function readPlan(text: string, availableAgentIds: Set<string>): PlanDraftTask[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new ExecutionPlanInvalidError();

  let decoded: unknown;
  try {
    decoded = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ExecutionPlanInvalidError();
  }
  if (
    !isRecord(decoded) ||
    !Array.isArray(decoded.tasks) ||
    decoded.tasks.length < 1 ||
    decoded.tasks.length > 12
  ) {
    throw new ExecutionPlanInvalidError();
  }

  const tasks = decoded.tasks.map((candidate) => readDraftTask(candidate, availableAgentIds));
  assertValidDependencies(tasks);
  return tasks;
}

export class ExecutionsService {
  constructor(
    private readonly repository: ExecutionsRepository,
    private readonly environment: AppEnvironment,
    private readonly openCode: OpenCodeGateway,
  ) {}

  create(input: CreateExecutionRequest): Promise<ExecutionRecord> {
    const requirement = input.requirement.trim();
    return this.repository.create({
      ...input,
      name: input.name?.trim() || requirement.slice(0, 80),
      requirement,
      budgetUsd: input.budgetUsd ?? this.environment.defaultExecutionBudgetUsd ?? undefined,
    });
  }

  list(): Promise<ExecutionRecord[]> {
    return this.repository.list();
  }

  async get(id: string): Promise<ExecutionDetails> {
    const execution = await this.repository.findDetails(id);
    if (!execution) throw new ExecutionNotFoundError();
    return execution;
  }

  async plan(id: string): Promise<ExecutionDetails> {
    const execution = await this.get(id);
    if (execution.status === "PLANNED" && execution.tasks.length > 0) return execution;
    if (execution.status !== "CREATED") throw new ExecutionPlanningConflictError();

    const planning = await this.repository.beginPlanningIfCreated(id, new Date());
    if (!planning)
      throw new ExecutionPlanningConflictError("Planning was already started for this execution.");

    try {
      const health = await this.openCode.health();
      if (health.status !== "ready") throw new OpenCodeUnavailableError();

      const agents = await this.openCode.listAgents();
      const availableAgentIds = new Set(agents.map((agent) => agent.id));
      if (!availableAgentIds.has("orchestrator")) throw new OpenCodeUnavailableError();

      const session = await this.openCode.createSession({
        title: `Plan: ${execution.name}`,
        agentId: "orchestrator",
      });
      const prompt = [
        "Create an implementation plan for the requirement below.",
        "Return only one JSON object with this shape:",
        '{"tasks":[{"key":"T1","agentId":"backend","title":"...","description":"...","acceptanceCriteria":["..."],"dependsOn":[]}]}',
        `Use only these agent IDs: ${[...availableAgentIds].join(", ")}.`,
        "Use 1 to 12 small, ordered tasks. Each task must include observable acceptance criteria.",
        "Dependencies must reference task keys in this response. Do not include markdown or extra fields.",
        `Requirement: ${execution.requirement}`,
      ].join("\n\n");
      const text = await this.openCode.generate(session.id, prompt);
      const draft = readPlan(text, availableAgentIds);
      const ids = new Map(draft.map((task) => [task.key, randomUUID()]));
      const tasks: PlannedTask[] = draft.map((task, sequence) => ({
        id: ids.get(task.key)!,
        sequence,
        agentId: task.agentId as PlannedTask["agentId"],
        title: task.title,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        dependsOn: task.dependsOn.map((key) => ids.get(key)!),
      }));
      const persisted = await this.repository.persistPlan(id, tasks, session.id);
      if (!persisted) throw new ExecutionPlanningConflictError();
      return persisted;
    } catch (error) {
      await this.repository.failPlanningIfActive(id, new Date());
      throw error;
    }
  }

  async cancel(id: string): Promise<ExecutionRecord> {
    const cancelled = await this.repository.cancelIfActive(id, new Date());
    return cancelled ?? this.getRecordOrThrow(id);
  }

  async events(id: string): Promise<DomainEvent[]> {
    await this.ensureExists(id);
    return this.repository.listEvents(id, null, 1000);
  }

  async usage(id: string): Promise<UsageSummary> {
    await this.ensureExists(id);
    return summarizeUsage(await this.repository.listUsage(id));
  }

  eventsAfter(id: string, cursor: EventCursor | null, limit: number): Promise<DomainEvent[]> {
    return this.repository.listEvents(id, cursor, limit);
  }

  private async ensureExists(id: string): Promise<void> {
    if (!(await this.repository.exists(id))) throw new ExecutionNotFoundError();
  }

  private async getRecordOrThrow(id: string): Promise<ExecutionRecord> {
    const execution = await this.repository.findDetails(id);
    if (!execution) throw new ExecutionNotFoundError();
    return {
      id: execution.id,
      name: execution.name,
      requirement: execution.requirement,
      status: execution.status,
      budgetUsd: execution.budgetUsd,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      createdAt: execution.createdAt,
    };
  }
}
