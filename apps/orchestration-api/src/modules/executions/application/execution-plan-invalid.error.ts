export class ExecutionPlanInvalidError extends Error {
  constructor() {
    super("OpenCode returned a plan that does not match the execution task contract.");
    this.name = "ExecutionPlanInvalidError";
  }
}
