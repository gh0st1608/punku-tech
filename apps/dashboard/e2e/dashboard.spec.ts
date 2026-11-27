import { expect, test } from "@playwright/test";

const executionId = "2da9a438-7fdc-4318-9caf-4894b73ef13c";
const taskId = "030247a4-fd3a-4567-9c10-27472538f509";
const execution = {
  id: executionId,
  name: "QA demo",
  requirement: "Validar la vista de ejecución, uso y entregables.",
  status: "RUNNING",
  budgetUsd: null,
  startedAt: "2026-11-27T10:00:00.000Z",
  finishedAt: null,
  createdAt: "2026-11-27T10:00:00.000Z",
};
const task = {
  id: taskId,
  sequence: 0,
  agentId: "backend",
  title: "Preparar API",
  description: "Crear y validar la API del servicio.",
  acceptanceCriteria: ["La API responde con health listo."],
  status: "COMPLETED",
  dependsOn: [],
  sessionId: "session-demo",
  summary: "Se verificó la respuesta del servicio.",
  artifactPaths: ["reports/api-summary.md"],
  startedAt: "2026-11-27T10:01:00.000Z",
  finishedAt: "2026-11-27T10:02:00.000Z",
};
const event = {
  eventId: "event-demo",
  executionId,
  eventType: "TASK_COMPLETED",
  occurredAt: "2026-11-27T10:02:00.000Z",
  source: "orchestration-api",
  agentId: "backend",
  taskId,
  sessionId: "session-demo",
  schemaVersion: 1,
  payload: {},
};
const usage = {
  turns: 1,
  tokenAvailability: "AVAILABLE",
  costStatus: "REPORTED",
  inputTokens: 1200,
  outputTokens: 450,
  reasoningTokens: 90,
  cacheReadTokens: 180,
  cacheWriteTokens: 0,
  unavailableUsageTurns: 0,
  reportedCostUsd: 0.0123,
  reportedCostTurns: 1,
  estimatedCostUsd: null,
  estimatedCostTurns: 0,
  unavailableCostTurns: 0,
  byAgent: [],
  byTask: [],
  byModel: [],
};

test("loads an execution, its usage and a task deliverable", async ({ page }) => {
  await page.route("http://127.0.0.1:3000/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/stream")) {
      await route.abort();
      return;
    }
    if (pathname === "/api/executions") {
      await route.fulfill({ json: [execution] });
      return;
    }
    if (pathname === `/api/executions/${executionId}`) {
      await route.fulfill({ json: { ...execution, tasks: [task], events: [event] } });
      return;
    }
    if (pathname === `/api/executions/${executionId}/events`) {
      await route.fulfill({ json: [event] });
      return;
    }
    if (pathname === `/api/executions/${executionId}/usage`) {
      await route.fulfill({ json: usage });
      return;
    }
    if (pathname === `/api/executions/${executionId}/tasks/${taskId}`) {
      await route.fulfill({ json: { ...task, events: [event] } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Agent Board." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Uso y costos" })).toBeVisible();
  await expect(page.getByText("1 turnos", { exact: true })).toBeVisible();
  await expect(page.getByText("$0.0123")).toBeVisible();

  await page.getByRole("button", { name: /Preparar API/ }).click();
  await expect(page.getByRole("heading", { name: "Resumen del agente" })).toBeVisible();
  await expect(page.getByText("Se verificó la respuesta del servicio.")).toBeVisible();
  await expect(page.getByText("reports/api-summary.md")).toBeVisible();
});
