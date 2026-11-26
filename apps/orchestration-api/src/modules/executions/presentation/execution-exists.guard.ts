import { BadRequestException, CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { Request } from "express";
import { ExecutionNotFoundError } from "../application/execution-not-found.error";
import { EventCursor, EXECUTIONS_REPOSITORY, ExecutionsRepository } from "../application/executions.repository";

type StreamRequest = Request<{ id: string }> & { eventCursor: EventCursor | null };

@Injectable()
export class ExecutionExistsGuard implements CanActivate {
  constructor(@Inject(EXECUTIONS_REPOSITORY) private readonly repository: ExecutionsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StreamRequest>();
    const id = request.params.id;

    if (!isUUID(id)) throw new BadRequestException("Execution id must be a UUID.");
    if (!(await this.repository.exists(id))) throw new ExecutionNotFoundError();

    const lastEventId = request.header("last-event-id");
    if (lastEventId) {
      if (!isUUID(lastEventId)) throw new BadRequestException("Last-Event-ID must be a UUID.");
      const cursor = await this.repository.findEventCursor(id, lastEventId);
      if (!cursor) throw new BadRequestException("Last-Event-ID is not an event for this execution.");
      request.eventCursor = cursor;
    } else {
      request.eventCursor = null;
    }
    return true;
  }
}
