export class ExecutionNotFoundError extends Error {
  constructor() {
    super("Execution not found");
    this.name = "ExecutionNotFoundError";
  }
}
