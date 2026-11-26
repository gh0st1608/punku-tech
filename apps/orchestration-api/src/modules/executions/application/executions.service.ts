import { CreateExecutionRequest, DomainEvent, ExecutionDetails, ExecutionRecord, UsageSummary } from "@aief/contracts";
import { AppEnvironment } from "../../../config/app-environment";
import { ExecutionNotFoundError } from "./execution-not-found.error";
import { EventCursor, ExecutionsRepository } from "./executions.repository";
import { summarizeUsage } from "./usage-summary";

export class ExecutionsService {
  constructor(
    private readonly repository: ExecutionsRepository,
    private readonly environment: AppEnvironment,
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

  async start(id: string): Promise<ExecutionRecord> {
    const started = await this.repository.startIfCreated(id, new Date());
    return started ?? this.getRecordOrThrow(id);
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
