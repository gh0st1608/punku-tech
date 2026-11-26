import { Body, Controller, Get, MessageEvent, Param, ParseUUIDPipe, Post, Req, Sse, UseGuards } from "@nestjs/common";
import { CreateExecutionRequest } from "@aief/contracts";
import { Observable, defer, from, map, mergeMap, repeat, tap } from "rxjs";
import { Request } from "express";
import { ExecutionsService } from "../application/executions.service";
import { EventCursor } from "../application/executions.repository";
import { CreateExecutionDto } from "./dto/create-execution.dto";
import { ExecutionExistsGuard } from "./execution-exists.guard";

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

  @Post(":id/start")
  start(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.executions.start(id);
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
  stream(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: StreamRequest): Observable<MessageEvent> {
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
