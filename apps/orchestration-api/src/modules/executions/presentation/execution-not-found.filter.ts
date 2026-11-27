import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { Catch } from "@nestjs/common";
import type { Response } from "express";
import { ExecutionNotFoundError } from "../application/execution-not-found.error";

@Catch(ExecutionNotFoundError)
export class ExecutionNotFoundFilter implements ExceptionFilter<ExecutionNotFoundError> {
  catch(_exception: ExecutionNotFoundError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(404)
      .json({ statusCode: 404, message: "Execution not found", error: "Not Found" });
  }
}
