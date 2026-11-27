import type { DomainEvent, ExecutionDetails, ExecutionRecord, TaskDetails } from "@aief/contracts";

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

export function listExecutions(signal?: AbortSignal): Promise<ExecutionRecord[]> {
  return request("/executions", signal);
}

export function getExecution(id: string, signal?: AbortSignal): Promise<ExecutionDetails> {
  return request(`/executions/${encodeURIComponent(id)}`, signal);
}

export function listEvents(id: string, signal?: AbortSignal): Promise<DomainEvent[]> {
  return request(`/executions/${encodeURIComponent(id)}/events`, signal);
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
