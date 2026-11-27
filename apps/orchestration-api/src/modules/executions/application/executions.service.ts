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

type RunnerLeaseState = { lost: boolean; lostPromise: Promise<void>; notifyLost: () => void };

const RUNNER_LEASE_MS = 30_000;
const RUNNER_HEARTBEAT_MS = 10_000;

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
  private readonly runnerId = randomUUID();

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
    const workspaceBranch = `aief/execution-${id}`;
    const started = await this.repository.startIfPlanned(id, {
      workspacePath,
      workspaceBranch,
      runnerId: this.runnerId,
      startedAt: new Date(),
      leaseUntil: this.leaseUntil(),
    });
    if (!started) throw new ExecutionPlanningConflictError("Execution has already been started.");

    try {
      await this.worktrees.create(id, workspaceBranch);
    } catch {
      await this.repository.failExecutionIfActive(id, this.runnerId, new Date());
      await this.repository.releaseExecutionLease(id, this.runnerId);
      throw new ExecutionWorkspaceUnavailableError();
    }

    this.runInBackground(id, true);
    return this.get(id);
  }

  private runInBackground(executionId: string, alreadyClaimed = false): void {
    void (async () => {
      let acquired = alreadyClaimed;
      try {
        if (!acquired) {
          acquired = await this.repository.claimRunningExecution(
            executionId,
            this.runnerId,
            new Date(),
            this.leaseUntil(),
          );
        }
        if (!acquired) return;
        await this.runWithLease(executionId);
      } catch {
        await this.repository.failExecutionIfActive(executionId, this.runnerId, new Date());
        this.logger.error(`Task runner stopped unexpectedly for execution ${executionId}.`);
      } finally {
        if (acquired) await this.repository.releaseExecutionLease(executionId, this.runnerId);
      }
    })().catch(() => {
      this.logger.error(`Task runner cleanup failed for execution ${executionId}.`);
    });
  }

  private async runWithLease(executionId: string): Promise<void> {
    let notifyLost!: () => void;
    const lease: RunnerLeaseState = {
      lost: false,
      lostPromise: new Promise<void>((resolve) => {
        notifyLost = resolve;
      }),
      notifyLost: () => notifyLost(),
    };
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || lease.lost) return;
      heartbeatRunning = true;
      void this.repository
        .renewExecutionLease(executionId, this.runnerId, this.leaseUntil())
        .then((renewed) => {
          if (!renewed) this.loseLease(executionId, lease);
        })
        .catch(() => this.loseLease(executionId, lease))
        .finally(() => {
          heartbeatRunning = false;
        });
    }, RUNNER_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      await this.executeTasks(executionId, lease);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private loseLease(executionId: string, lease: RunnerLeaseState): void {
    if (lease.lost) return;
    lease.lost = true;
    lease.notifyLost();
    this.logger.warn(`Runner lease was lost for execution ${executionId}.`);
  }

  private async ensureLease(executionId: string, lease: RunnerLeaseState): Promise<boolean> {
    if (lease.lost) return false;
    try {
      const renewed = await this.repository.renewExecutionLease(
        executionId,
        this.runnerId,
        this.leaseUntil(),
      );
      if (!renewed) this.loseLease(executionId, lease);
      return renewed;
    } catch {
      this.loseLease(executionId, lease);
      return false;
    }
  }

  private async executeTasks(executionId: string, lease: RunnerLeaseState): Promise<void> {
    const workspacePath = await this.repository.workspacePath(executionId);
    if (
      workspacePath !== this.worktrees.directoryFor(executionId) ||
      !(await this.worktrees.validate(executionId))
    ) {
      throw new Error("Execution workspace is missing or invalid.");
    }

    while (!lease.lost) {
      const execution = await this.get(executionId);
      if (lease.lost || execution.status !== "RUNNING") return;
      const runningTask = execution.tasks.find((item) => item.status === "RUNNING");
      const task = runningTask ?? this.nextRunnableTask(execution.tasks);
      if (!task) {
        const hasPendingTasks = execution.tasks.some((item) => item.status === "PENDING");
        if (hasPendingTasks) {
          await this.repository.failExecutionIfActive(executionId, this.runnerId, new Date());
          return;
        }
        await this.repository.completeExecutionIfTasksDone(executionId, this.runnerId, new Date());
        return;
      }
      if (!runningTask && (await this.pauseForBudgetIfNeeded(executionId, execution.budgetUsd)))
        return;
      if (!(await this.executeTask(executionId, task, workspacePath, lease))) return;
    }
  }

  private async pauseForBudgetIfNeeded(
    executionId: string,
    budgetUsd: number | null,
  ): Promise<boolean> {
    if (budgetUsd === null) return false;
    const usage = summarizeUsage(await this.repository.listUsage(executionId));
    const spentUsd = (usage.reportedCostUsd ?? 0) + (usage.estimatedCostUsd ?? 0);
    return (
      (await this.repository.enforceBudgetLimit(executionId, this.runnerId, spentUsd)) === "PAUSED"
    );
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
    lease: RunnerLeaseState,
  ): Promise<boolean> {
    if (!(await this.prepareTask(executionId, task, lease))) return false;
    const sessionId = await this.getOrCreateTaskSession(executionId, task, workspacePath, lease);
    if (!sessionId) return false;
    return this.runTaskSession(executionId, task, sessionId, lease);
  }

  private async prepareTask(
    executionId: string,
    task: TaskRecord,
    lease: RunnerLeaseState,
  ): Promise<boolean> {
    if (!(await this.ensureLease(executionId, lease))) return false;
    if (
      task.status === "PENDING" &&
      !(await this.repository.startTaskIfPending(executionId, task.id, this.runnerId, new Date()))
    ) {
      return false;
    }
    return true;
  }

  private async getOrCreateTaskSession(
    executionId: string,
    task: TaskRecord,
    workspacePath: string,
    lease: RunnerLeaseState,
  ): Promise<string | null> {
    if (task.sessionId) return task.sessionId;
    if (!(await this.ensureLease(executionId, lease))) return null;

    const agents = await this.openCode.listAgents(workspacePath);
    if (!(await this.ensureLease(executionId, lease))) return null;
    if (!agents.some((agent) => agent.id === task.agentId)) {
      await this.repository.failTaskAndExecution(executionId, task.id, this.runnerId, new Date());
      return null;
    }

    const session = await this.openCode.createSession({
      title: `${task.agentId}: ${task.title}`,
      agentId: task.agentId as (typeof agentIds)[number],
      directory: workspacePath,
    });
    if (!(await this.ensureLease(executionId, lease))) {
      await this.openCode.interrupt(session.id).catch(() => false);
      return null;
    }

    const attached = await this.repository.attachTaskSession(
      executionId,
      task.id,
      this.runnerId,
      session.id,
    );
    if (attached) return session.id;
    await this.openCode.interrupt(session.id).catch(() => false);
    return null;
  }

  private async runTaskSession(
    executionId: string,
    task: TaskRecord,
    sessionId: string,
    lease: RunnerLeaseState,
  ): Promise<boolean> {
    const prompt = this.taskPrompt(task);
    if (!(await this.ensureLease(executionId, lease))) return false;
    const hasPrompt = await this.openCode.hasPrompt(sessionId, prompt);
    if (!(await this.ensureLease(executionId, lease))) return false;
    if (!hasPrompt) await this.openCode.prompt(sessionId, prompt);
    if (!(await this.ensureLease(executionId, lease))) return false;

    await Promise.race([this.openCode.wait(sessionId), lease.lostPromise]);
    if (!(await this.ensureLease(executionId, lease))) return false;
    const result = await this.openCode.latestAssistantResult(sessionId);
    if (!(await this.ensureLease(executionId, lease))) return false;
    if (result?.finish !== "stop") {
      await this.repository.failTaskAndExecution(executionId, task.id, this.runnerId, new Date());
      return false;
    }

    return this.repository.completeTask(executionId, task.id, {
      runnerId: this.runnerId,
      finishedAt: new Date(),
      deliverables: {
        summary: sanitizeTaskSummary(result.summary),
        artifactPaths: sanitizeArtifactPaths(result.artifactPaths),
      },
    });
  }

  private leaseUntil(now = Date.now()): Date {
    return new Date(now + RUNNER_LEASE_MS);
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

  async approveBudget(id: string, newBudgetUsd: number): Promise<ExecutionRecord> {
    const approved = await this.repository.approveBudget(id, newBudgetUsd);
    if (!approved)
      throw new ExecutionPlanningConflictError(
        "Execution must be paused at its budget limit and the approved limit must be higher.",
      );
    this.runInBackground(id);
    return this.getRecordOrThrow(id);
  }

  async events(id: string): Promise<DomainEvent[]> {
    await this.ensureExists(id);
    return this.repository.listEvents(id, null, 1000);
  }

  async usage(
    id: string,
    filters: { from?: string; to?: string; model?: string } = {},
  ): Promise<UsageSummary> {
    const execution = await this.get(id);
    const completedTaskIds = new Set(
      execution.tasks.filter((task) => task.status === "COMPLETED").map((task) => task.id),
    );
    const rows = (await this.repository.listUsage(id)).filter((row) => {
      if (
        filters.model &&
        `${row.provider ?? "unknown-provider"}/${row.model ?? "unknown-model"}` !== filters.model
      )
        return false;
      const recordedAt = row.recordedAt.slice(0, 10);
      if (filters.from && recordedAt < filters.from) return false;
      if (filters.to && recordedAt > filters.to) return false;
      return true;
    });
    return summarizeUsage(rows, completedTaskIds);
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
      workspaceBranch: execution.workspaceBranch,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      createdAt: execution.createdAt,
    };
  }
}
