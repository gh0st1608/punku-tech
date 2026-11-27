import type { MessageEvent } from "@nestjs/common";
import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Sse,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { CreateExecutionRequest } from "@aief/contracts";
import type { Observable } from "rxjs";
import { defer, from, map, mergeMap, repeat, tap } from "rxjs";
import type { Request } from "express";
import type { ExecutionsService } from "../application/executions.service";
import type { EventCursor } from "../application/executions.repository";
import type { CreateExecutionDto } from "./dto/create-execution.dto";
import { ExecutionExistsGuard } from "./execution-exists.guard";
import { ExecutionPlanningConflictError } from "../application/execution-planning-conflict.error";
import { ExecutionPlanInvalidError } from "../application/execution-plan-invalid.error";
import { OpenCodeUnavailableError } from "../../opencode/application/opencode-unavailable.error";
import { ExecutionWorkspaceUnavailableError } from "../application/execution-workspace-unavailable.error";

type StreamRequest = Request<{ id: string }> & { eventCursor: EventCursor | null };

@Controller("executions")
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

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

  @Get(":id/events")
  events(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.executions.events(id);
  }

  @Get(":id/usage")
  usage(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.executions.usage(id);
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
