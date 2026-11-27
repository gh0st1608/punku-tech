import type {
  DomainEvent,
  CreateProjectRequest,
  ExecutionDetails,
  ExecutionRecord,
  ProjectRecord,
  TaskDetails,
  UpdateProjectRequest,
  UsageSummary,
} from "@aief/contracts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3000/api").replace(
  /\/$/,
  "",
);

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { signal });
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? "El recurso ya no existe." : "No se pudo cargar la API.",
    );
  }
  return (await response.json()) as T;
}

async function send<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404 ? "El proyecto ya no existe." : "No se pudo guardar el proyecto.",
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listProjects(signal?: AbortSignal): Promise<ProjectRecord[]> {
  return request("/projects", signal);
}

export function createProject(input: CreateProjectRequest): Promise<ProjectRecord> {
  return send("/projects", "POST", input);
}

export function updateProject(id: string, input: UpdateProjectRequest): Promise<ProjectRecord> {
  return send(`/projects/${encodeURIComponent(id)}`, "PATCH", input);
}

export function deleteProject(id: string): Promise<void> {
  return send(`/projects/${encodeURIComponent(id)}`, "DELETE");
}

export function listExecutions(signal?: AbortSignal): Promise<ExecutionRecord[]> {
  return request("/executions", signal);
}

export function getExecution(id: string, signal?: AbortSignal): Promise<ExecutionDetails> {
  return request(`/executions/${encodeURIComponent(id)}`, signal);
}

export function listEvents(id: string, signal?: AbortSignal): Promise<DomainEvent[]> {
  return request(`/executions/${encodeURIComponent(id)}/events`, signal);
}

export function getUsage(id: string, signal?: AbortSignal): Promise<UsageSummary> {
  return request(`/executions/${encodeURIComponent(id)}/usage`, signal);
}

export function approveExecutionBudget(id: string, newBudgetUsd: number): Promise<ExecutionRecord> {
  return send<ExecutionRecord>(`/executions/${encodeURIComponent(id)}/approve-budget`, "POST", {
    newBudgetUsd,
  }).catch(() => {
    throw new Error("No se pudo aprobar el nuevo límite de presupuesto.");
  });
}

export function cancelExecution(id: string): Promise<ExecutionRecord> {
  return send<ExecutionRecord>(`/executions/${encodeURIComponent(id)}/cancel`, "POST").catch(() => {
    throw new Error("No se pudo cancelar la ejecución.");
  });
}

export function getTaskDetails(
  executionId: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<TaskDetails> {
  return request(
    `/executions/${encodeURIComponent(executionId)}/tasks/${encodeURIComponent(taskId)}`,
    signal,
  );
}

export function createExecutionEventSource(executionId: string): EventSource {
  return new EventSource(`${apiBaseUrl}/executions/${encodeURIComponent(executionId)}/stream`);
}
