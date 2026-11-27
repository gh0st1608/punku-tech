import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import type { OnApplicationBootstrap } from "@nestjs/common";
import type {
  CreateExecutionRequest,
  DomainEvent,
  ExecutionDetails,
  ExecutionRecord,
  PlannedTask,
  TaskRecord,
  TaskDetails,
  UsageSummary,
} from "@aief/contracts";
import { agentIds } from "@aief/contracts";
import type { AppEnvironment } from "../../../config/app-environment";
import { OpenCodeUnavailableError } from "../../opencode/application/opencode-unavailable.error";
import type { OpenCodeGateway } from "../../opencode/application/opencode.gateway";
import { ExecutionNotFoundError } from "./execution-not-found.error";
import { sanitizeArtifactPaths, sanitizeTaskSummary } from "./task-deliverables";
import { ExecutionPlanInvalidError } from "./execution-plan-invalid.error";
import { ExecutionPlanningConflictError } from "./execution-planning-conflict.error";
import type { EventCursor, ExecutionsRepository } from "./executions.repository";
import type { GitWorktreeManager } from "../infrastructure/git-worktree.manager";
import { ExecutionWorkspaceUnavailableError } from "./execution-workspace-unavailable.error";
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

export class ExecutionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    private readonly repository: ExecutionsRepository,
    private readonly environment: AppEnvironment,
    private readonly openCode: OpenCodeGateway,
    private readonly worktrees: GitWorktreeManager,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const runningExecutionIds = await this.repository.listRunningExecutionIds();
    for (const executionId of runningExecutionIds) this.runInBackground(executionId);
  }

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

  getTask(executionId: string, taskId: string): Promise<TaskDetails | null> {
    return this.repository.findTaskDetails(executionId, taskId);
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

  async start(id: string): Promise<ExecutionDetails> {
    const execution = await this.get(id);
    if (execution.status !== "PLANNED" || execution.tasks.length === 0) {
      throw new ExecutionPlanningConflictError(
        "Execution must have a saved plan before it can start.",
      );
    }

    const workspacePath = resolve(this.environment.opencodeWorktreeRoot, id);
    const started = await this.repository.startIfPlanned(id, workspacePath, new Date());
    if (!started) throw new ExecutionPlanningConflictError("Execution has already been started.");

    try {
      await this.worktrees.create(id);
    } catch {
      await this.repository.failExecutionIfActive(id, new Date());
      throw new ExecutionWorkspaceUnavailableError();
    }

    this.runInBackground(id);
    return this.get(id);
  }

  private runInBackground(executionId: string): void {
    void this.executeTasks(executionId).catch(async () => {
      await this.repository.failExecutionIfActive(executionId, new Date());
      this.logger.error(`Task runner stopped unexpectedly for execution ${executionId}.`);
    });
  }

  private async executeTasks(executionId: string): Promise<void> {
    const workspacePath = await this.repository.workspacePath(executionId);
    if (
      workspacePath !== this.worktrees.directoryFor(executionId) ||
      !(await this.worktrees.validate(executionId))
    ) {
      throw new Error("Execution workspace is missing or invalid.");
    }

    while (true) {
      const execution = await this.get(executionId);
      if (execution.status !== "RUNNING") return;
      const runningTask = execution.tasks.find((item) => item.status === "RUNNING");
      const task = runningTask ?? this.nextRunnableTask(execution.tasks);
      if (!task) {
        const hasPendingTasks = execution.tasks.some((item) => item.status === "PENDING");
        if (hasPendingTasks) {
          await this.repository.failExecutionIfActive(executionId, new Date());
          return;
        }
        await this.repository.completeExecutionIfTasksDone(executionId, new Date());
        return;
      }
      if (!(await this.executeTask(executionId, task, workspacePath))) return;
    }
  }

  private nextRunnableTask(tasks: TaskRecord[]): TaskRecord | null {
    return (
      tasks
        .filter((task) => task.status === "PENDING")
        .sort((left, right) => left.sequence - right.sequence)
        .find((candidate) =>
          candidate.dependsOn.every((dependencyId) =>
            tasks.some(
              (dependency) => dependency.id === dependencyId && dependency.status === "COMPLETED",
            ),
          ),
        ) ?? null
    );
  }

  private async executeTask(
    executionId: string,
    task: TaskRecord,
    workspacePath: string,
  ): Promise<boolean> {
    if (
      task.status === "PENDING" &&
      !(await this.repository.startTaskIfPending(executionId, task.id, new Date()))
    ) {
      return false;
    }

    let sessionId = task.sessionId;
    if (!sessionId) {
      const availableAgentIds = new Set(
        (await this.openCode.listAgents(workspacePath)).map((agent) => agent.id),
      );
      if (!availableAgentIds.has(task.agentId)) {
        await this.repository.failTaskAndExecution(executionId, task.id, new Date());
        return false;
      }

      const session = await this.openCode.createSession({
        title: `${task.agentId}: ${task.title}`,
        agentId: task.agentId as (typeof agentIds)[number],
        directory: workspacePath,
      });
      const attached = await this.repository.attachTaskSession(executionId, task.id, session.id);
      if (!attached) {
        await this.openCode.interrupt(session.id).catch(() => false);
        return false;
      }
      sessionId = session.id;
    }

    const prompt = this.taskPrompt(task);
    if (!(await this.openCode.hasPrompt(sessionId, prompt))) {
      await this.openCode.prompt(sessionId, prompt);
    }
    await this.openCode.wait(sessionId);
    const result = await this.openCode.latestAssistantResult(sessionId);
    if (result?.finish !== "stop") {
      await this.repository.failTaskAndExecution(executionId, task.id, new Date());
      return false;
    }
    return this.repository.completeTask(executionId, task.id, new Date(), {
      summary: sanitizeTaskSummary(result.summary),
      artifactPaths: sanitizeArtifactPaths(result.artifactPaths),
    });
  }

  private taskPrompt(task: TaskRecord): string {
    return [
      "Implement only this planned task in the supplied isolated workspace.",
      "Respect the repository instructions and existing coding standards.",
      "Do not deploy, publish, push, merge, or modify any other workspace.",
      "Before finishing, review your changes against every acceptance criterion.",
      `Task: ${task.title}`,
      `Description: ${task.description}`,
      `Acceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
    ].join("\n\n");
  }

  async cancel(id: string): Promise<ExecutionRecord> {
    const cancelled = await this.repository.cancelIfActive(id, new Date());
    if (!cancelled) return this.getRecordOrThrow(id);
    const interrupts = await Promise.allSettled(
      cancelled.sessionIds.map((sessionId) => this.openCode.interrupt(sessionId)),
    );
    if (interrupts.some((result) => result.status === "rejected")) {
      this.logger.warn(
        `One or more OpenCode sessions could not be interrupted for execution ${id}.`,
      );
    }
    return cancelled.execution;
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
