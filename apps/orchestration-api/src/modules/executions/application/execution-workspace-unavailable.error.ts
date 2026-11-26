export class ExecutionWorkspaceUnavailableError extends Error {
  constructor() {
    super("The isolated execution workspace could not be prepared.");
    this.name = "ExecutionWorkspaceUnavailableError";
  }
}
