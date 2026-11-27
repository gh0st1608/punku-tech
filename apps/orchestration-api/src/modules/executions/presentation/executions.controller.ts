import type { MessageEvent } from "@nestjs/common";
import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Sse,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { CreateExecutionRequest } from "@aief/contracts";
import type { Observable } from "rxjs";
import { defer, from, map, mergeMap, repeat, tap } from "rxjs";
import type { Request } from "express";
import { ExecutionsService } from "../application/executions.service";
import type { EventCursor } from "../application/executions.repository";
// Keep this as a runtime import so Nest's ValidationPipe receives the DTO class metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CreateExecutionDto } from "./dto/create-execution.dto";
import { ExecutionExistsGuard } from "./execution-exists.guard";
import { ExecutionPlanningConflictError } from "../application/execution-planning-conflict.error";
import { ExecutionPlanInvalidError } from "../application/execution-plan-invalid.error";
import { OpenCodeUnavailableError } from "../../opencode/application/opencode-unavailable.error";
import { ExecutionWorkspaceUnavailableError } from "../application/execution-workspace-unavailable.error";
// Keep this as a runtime import so Nest's ValidationPipe receives the DTO class metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ApproveBudgetDto } from "./dto/approve-budget.dto";

type StreamRequest = Request<{ id: string }> & { eventCursor: EventCursor | null };

@Controller("executions")
export class ExecutionsController {
  constructor(@Inject(ExecutionsService) private readonly executions: ExecutionsService) {}

  @Post()
  create(@Body() body: CreateExecutionDto) {
    return this.executions.create(body satisfies CreateExecutionRequest);
  }

  @Get()
  list() {
    return this.executions.list();
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.executions.get(id);
  }

  @Get(":id/tasks/:taskId")
  async getTask(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("taskId", new ParseUUIDPipe()) taskId: string,
  ) {
    const task = await this.executions.getTask(id, taskId);
    if (!task) throw new NotFoundException("Task not found");
    return task;
  }

  @Post(":id/plan")
  async plan(@Param("id", new ParseUUIDPipe()) id: string) {
    try {
      return await this.executions.plan(id);
    } catch (error) {
      if (error instanceof ExecutionPlanningConflictError)
        throw new ConflictException(error.message);
      if (error instanceof OpenCodeUnavailableError)
        throw new ServiceUnavailableException(error.message);
      if (error instanceof ExecutionPlanInvalidError) throw new BadGatewayException(error.message);
      throw error;
    }
  }

  @Post(":id/start")
  async start(@Param("id", new ParseUUIDPipe()) id: string) {
    try {
      return await this.executions.start(id);
    } catch (error) {
      if (error instanceof ExecutionPlanningConflictError)
        throw new ConflictException(error.message);
      if (error instanceof ExecutionWorkspaceUnavailableError)
        throw new ServiceUnavailableException(error.message);
      if (error instanceof OpenCodeUnavailableError)
        throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }

  @Post(":id/cancel")
  cancel(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.executions.cancel(id);
  }

  @Post(":id/approve-budget")
  async approveBudget(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: ApproveBudgetDto,
  ) {
    try {
      return await this.executions.approveBudget(id, body.newBudgetUsd);
    } catch (error) {
      if (error instanceof ExecutionPlanningConflictError)
        throw new ConflictException(error.message);
      throw error;
    }
  }

  @Get(":id/events")
  events(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.executions.events(id);
  }

  @Get(":id/usage")
  usage(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("model") model?: string,
  ) {
    for (const date of [from, to]) {
      const parsed = date ? new Date(`${date}T00:00:00.000Z`) : null;
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !parsed ||
          Number.isNaN(parsed.getTime()) ||
          parsed.toISOString().slice(0, 10) !== date)
      ) {
        throw new BadRequestException("Usage dates must use the YYYY-MM-DD format.");
      }
    }
    if (from && to && from > to)
      throw new BadRequestException("The start date must not be after the end date.");
    return this.executions.usage(id, { from, to, model });
  }

  @Sse(":id/stream")
  @UseGuards(ExecutionExistsGuard)
  stream(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: StreamRequest,
  ): Observable<MessageEvent> {
    let cursor = request.eventCursor;
    return defer(() => from(this.executions.eventsAfter(id, cursor, 1000))).pipe(
      tap((events) => {
        const last = events.at(-1);
        if (last) cursor = { occurredAt: last.occurredAt, eventId: last.eventId };
      }),
      repeat({ delay: 2000 }),
      mergeMap((events) => from(events)),
      map((event) => ({ id: event.eventId, type: event.eventType, data: event })),
    );
  }
}
