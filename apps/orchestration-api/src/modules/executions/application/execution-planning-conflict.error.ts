export class ExecutionPlanningConflictError extends Error {
  constructor(message = "Execution cannot be planned from its current status.") {
    super(message);
    this.name = "ExecutionPlanningConflictError";
  }
}
