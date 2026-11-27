import { expect, test } from "@playwright/test";

const executionId = "2da9a438-7fdc-4318-9caf-4894b73ef13c";
const taskId = "030247a4-fd3a-4567-9c10-27472538f509";
const demoTimestamp = "2026-11-27T10:00:00.000Z";
const taskFinishedAt = "2026-11-27T10:02:00.000Z";
const execution = {
  id: executionId,
  name: "QA demo",
  requirement: "Validar la vista de ejecución, uso y entregables.",
  status: "RUNNING",
  budgetUsd: null,
  startedAt: demoTimestamp,
  finishedAt: null,
  createdAt: demoTimestamp,
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
  finishedAt: taskFinishedAt,
};
const event = {
  eventId: "event-demo",
  executionId,
  eventType: "TASK_COMPLETED",
  occurredAt: taskFinishedAt,
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

test("creates a project from the dashboard", async ({ page }) => {
  const project = {
    id: "006b5407-9919-4c36-8eab-1c65d70ad6ce",
    name: "Demo mínima",
    description: "Proyecto local para la demo.",
    status: "ACTIVE",
    priority: "HIGH",
    createdAt: demoTimestamp,
    updatedAt: demoTimestamp,
  };
  let projects: (typeof project)[] = [];

  await page.route("http://127.0.0.1:3000/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/projects" && route.request().method() === "POST") {
      projects = [project];
      await route.fulfill({ status: 201, json: project });
      return;
    }
    if (pathname === "/api/projects") {
      await route.fulfill({ json: projects });
      return;
    }
    if (pathname.endsWith("/stream")) {
      await route.abort();
      return;
    }
    if (pathname === "/api/executions") {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Nuevo proyecto/ }).click();
  await page.getByLabel(/Nombre/).fill(project.name);
  await page.getByLabel(/Descripci/).fill(project.description);
  await page.getByRole("button", { name: "Crear proyecto" }).click();

  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  expect(projects).toHaveLength(1);
});

test("approves a higher budget and resumes a paused execution", async ({ page }) => {
  let currentExecution = { ...execution, status: "PAUSED_BUDGET", budgetUsd: 10 };
  await page.route("http://127.0.0.1:3000/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/stream")) {
      await route.abort();
      return;
    }
    if (pathname === "/api/executions" && route.request().method() === "GET") {
      await route.fulfill({ json: [currentExecution] });
      return;
    }
    if (pathname === `/api/executions/${executionId}/approve-budget`) {
      const body = route.request().postDataJSON() as { newBudgetUsd: number };
      currentExecution = { ...currentExecution, status: "RUNNING", budgetUsd: body.newBudgetUsd };
      await route.fulfill({ status: 201, json: currentExecution });
      return;
    }
    if (pathname === `/api/executions/${executionId}`) {
      await route.fulfill({ json: { ...currentExecution, tasks: [task], events: [event] } });
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
    await route.fulfill({ status: 404, json: { message: "Not found" } });
  });

  await page.goto("/");
  await expect(page.getByText("Pausada por presupuesto").first()).toBeVisible();
  await page.getByLabel("Nuevo límite de presupuesto en USD").fill("25");
  await page.getByRole("button", { name: "Aprobar y reanudar" }).click();

  await expect(page.getByText("En ejecución").first()).toBeVisible();
  await expect(page.getByText("Presupuesto alcanzado")).toHaveCount(0);
  expect(currentExecution.budgetUsd).toBe(25);
});
