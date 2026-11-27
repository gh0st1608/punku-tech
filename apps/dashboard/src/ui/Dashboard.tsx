import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DomainEvent,
  ExecutionDetails,
  ExecutionRecord,
  TaskDetails,
  TaskRecord,
  UsageBreakdown,
  UsageSummary,
} from "@aief/contracts";
import {
  approveExecutionBudget,
  cancelExecution,
  createExecutionEventSource,
  getExecution,
  getTaskDetails,
  getUsage,
  listEvents,
  listExecutions,
} from "../api";
import { ProjectWorkspace } from "./ProjectWorkspace";

const boardAgents = [
  { id: "backend", label: "Backend", short: "BE", color: "violet" },
  { id: "frontend", label: "Frontend", short: "FE", color: "blue" },
  { id: "devops", label: "DevOps", short: "DO", color: "orange" },
  { id: "qa", label: "QA", short: "QA", color: "green" },
  { id: "security", label: "Security", short: "SC", color: "red" },
  { id: "documentation", label: "Documentación", short: "DC", color: "gold" },
] as const;

const eventTypes = [
  "EXECUTION_CREATED",
  "EXECUTION_PLANNING_REQUESTED",
  "EXECUTION_PLAN_CREATED",
  "EXECUTION_STARTED",
  "EXECUTION_FAILED",
  "EXECUTION_COMPLETED",
  "EXECUTION_CANCELLED",
  "EXECUTION_BUDGET_WARNING",
  "EXECUTION_BUDGET_PAUSED",
  "EXECUTION_BUDGET_APPROVED",
  "TASK_STARTED",
  "TASK_SESSION_CREATED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.usage.updated",
];

const executionStatusNames: Record<string, string> = {
  CREATED: "Creada",
  PLANNING: "Planificando",
  PLANNED: "Plan lista",
  RUNNING: "En ejecución",
  PAUSED_BUDGET: "Pausada por presupuesto",
  VALIDATING: "Validando",
  COMPLETED: "Completada",
  FAILED: "Fallida",
  CANCELLED: "Cancelada",
};

const taskStatusNames: Record<string, string> = {
  PENDING: "Pendiente",
  RUNNING: "En curso",
  BLOCKED: "Bloqueada",
  COMPLETED: "Completada",
  FAILED: "Fallida",
  CANCELLED: "Cancelada",
};

const eventNames: Record<string, string> = {
  EXECUTION_CREATED: "Ejecución creada",
  EXECUTION_PLANNING_REQUESTED: "Planificación iniciada",
  EXECUTION_PLAN_CREATED: "Plan listo",
  EXECUTION_STARTED: "Ejecución iniciada",
  EXECUTION_FAILED: "Ejecución fallida",
  EXECUTION_COMPLETED: "Ejecución completada",
  EXECUTION_CANCELLED: "Ejecución cancelada",
  EXECUTION_BUDGET_WARNING: "Alerta de presupuesto al 80%",
  EXECUTION_BUDGET_PAUSED: "Ejecución pausada por presupuesto",
  EXECUTION_BUDGET_APPROVED: "Nuevo presupuesto aprobado",
  TASK_STARTED: "Tarea iniciada",
  TASK_SESSION_CREATED: "Sesión del agente creada",
  TASK_COMPLETED: "Tarea completada",
  TASK_FAILED: "Tarea fallida",
  TASK_CANCELLED: "Tarea cancelada",
  "session.execution.started": "Agente iniciado",
  "session.execution.succeeded": "Agente terminó su ejecución",
  "session.execution.failed": "Fallo de agente",
  "session.execution.interrupted": "Agente interrumpido",
  "session.step.started": "Paso iniciado",
  "session.step.ended": "Paso finalizado",
  "session.step.failed": "Paso fallido",
  "session.tool.called": "Herramienta invocada",
  "session.tool.success": "Herramienta completada",
  "session.tool.failed": "Herramienta fallida",
  "session.usage.updated": "Uso actualizado",
};

type AgentDefinition = (typeof boardAgents)[number];

function mergeEvents(current: DomainEvent[], incoming: DomainEvent[]): DomainEvent[] {
  const byId = new Map(current.map((event) => [event.eventId, event]));
  for (const event of incoming) byId.set(event.eventId, event);
  return [...byId.values()]
    .sort((left, right) => {
      const byDate = left.occurredAt.localeCompare(right.occurredAt);
      return byDate || left.eventId.localeCompare(right.eventId);
    })
    .slice(-1000);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function timeAgo(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}

function statusTone(status: string): string {
  if (["RUNNING", "PLANNING", "VALIDATING"].includes(status)) return "active";
  if (status === "PAUSED_BUDGET") return "muted";
  if (["COMPLETED", "PLANNED"].includes(status)) return "success";
  if (["FAILED", "BLOCKED"].includes(status)) return "danger";
  if (status === "CANCELLED") return "muted";
  return "waiting";
}

function statusLabel(status: string): string {
  return executionStatusNames[status] ?? taskStatusNames[status] ?? status;
}

function formatTokens(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("es-PE").format(value);
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  }).format(value);
}

function costStatusLabel(status: string): string {
  return status === "MIXED" ? "MIXTO" : status;
}

function UsagePanel({ usage }: { usage: UsageSummary | null }) {
  const [dimension, setDimension] = useState<"agent" | "task" | "model">("agent");
  const dimensions = {
    agent: { label: "Agente", rows: usage?.byAgent ?? [] },
    task: { label: "Tarea", rows: usage?.byTask ?? [] },
    model: { label: "Modelo", rows: usage?.byModel ?? [] },
  };
  const activeDimension = dimensions[dimension];

  return (
    <section className="usage-panel" aria-label="Uso y costos">
      <div className="usage-heading">
        <div>
          <span className="section-kicker">FINOPS</span>
          <h2>Uso y costos</h2>
        </div>
        <span className="usage-turns">{usage ? `${usage.turns} turnos` : "Cargando"}</span>
      </div>
      {usage ? (
        <>
          <div className="usage-token-grid">
            <UsageMetric label="INPUT" value={usage.inputTokens} />
            <UsageMetric label="OUTPUT" value={usage.outputTokens} />
            <UsageMetric label="RAZONAMIENTO" value={usage.reasoningTokens} />
            <UsageMetric label="CACHE LECTURA" value={usage.cacheReadTokens} />
            <UsageMetric label="CACHE ESCRITURA" value={usage.cacheWriteTokens} />
          </div>
          <div className="usage-cost-grid">
            <div className="usage-cost-card reported">
              <span>COSTO REPORTADO</span>
              <strong>{formatUsd(usage.reportedCostUsd)}</strong>
              <small>REPORTED · {usage.reportedCostTurns} turnos</small>
            </div>
            <div className="usage-cost-card estimated">
              <span>COSTO ESTIMADO</span>
              <strong>{formatUsd(usage.estimatedCostUsd)}</strong>
              <small>ESTIMATED · {usage.estimatedCostTurns} turnos</small>
            </div>
            <div className="usage-cost-card unavailable">
              <span>SIN COSTO</span>
              <strong>{usage.unavailableCostTurns}</strong>
              <small>UNAVAILABLE · turnos sin tarifa</small>
            </div>
          </div>
          <div className="usage-breakdown-heading">
            <div>
              <strong>Desglose</strong>
              <span>
                {usage.tokenAvailability} · costo {costStatusLabel(usage.costStatus)}
              </span>
            </div>
            <div className="usage-tabs" role="tablist" aria-label="Dimensión del desglose">
              {Object.entries(dimensions).map(([key, item]) => (
                <button
                  aria-selected={dimension === key}
                  className={dimension === key ? "active" : ""}
                  key={key}
                  onClick={() => setDimension(key as typeof dimension)}
                  role="tab"
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {activeDimension.rows.length ? (
            <div className="usage-table-wrap">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>{activeDimension.label}</th>
                    <th>Turnos</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Razon.</th>
                    <th>Cache lee</th>
                    <th>Cache escribe</th>
                    <th>Reportado</th>
                    <th>Estimado</th>
                    <th>Sin tarifa</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDimension.rows.map((row) => (
                    <UsageBreakdownRow dimension={dimension} key={row.key} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="usage-empty">
              El proveedor todavía no reporta datos de uso para esta ejecución.
            </p>
          )}
        </>
      ) : (
        <p className="usage-empty">Cargando uso por turno…</p>
      )}
    </section>
  );
}

function UsageMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="usage-token-card">
      <span>{label}</span>
      <strong>{formatTokens(value)}</strong>
    </div>
  );
}

function UsageBreakdownRow({ row, dimension }: { row: UsageBreakdown; dimension: string }) {
  return (
    <tr>
      <td>
        <strong>{row.label}</strong>
        {dimension === "model" && (
          <small>
            {row.rateVersions.length
              ? `Tarifa ${row.rateVersions.join(", ")}`
              : "Sin tarifa configurada"}
          </small>
        )}
      </td>
      <td>{row.turns}</td>
      <td>{formatTokens(row.inputTokens)}</td>
      <td>{formatTokens(row.outputTokens)}</td>
      <td>{formatTokens(row.reasoningTokens)}</td>
      <td>{formatTokens(row.cacheReadTokens)}</td>
      <td>{formatTokens(row.cacheWriteTokens)}</td>
      <td>{formatUsd(row.reportedCostUsd)}</td>
      <td>{formatUsd(row.estimatedCostUsd)}</td>
      <td>{row.unavailableCostTurns}</td>
    </tr>
  );
}

function agentTasks(agent: AgentDefinition, tasks: TaskRecord[]): TaskRecord[] {
  return tasks.filter((task) => task.agentId === agent.id).sort((a, b) => a.sequence - b.sequence);
}

function taskForAgent(tasks: TaskRecord[]): TaskRecord | undefined {
  return tasks.find((task) => task.status === "RUNNING") ?? tasks.at(-1);
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function redactSensitiveText(value: string): string {
  const patterns = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{8,}/gi,
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
  ];
  const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  return patterns
    .reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value)
    .replace(ansiEscape, "")
    .trim();
}

function useExecutionCatalog(setError: (message: string) => void) {
  const [executions, setExecutions] = useState<ExecutionRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    listExecutions(controller.signal)
      .then((items) => {
        setExecutions(items);
        setActiveId((current) => current || items[0]?.id || "");
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("No se pudo conectar con la API. Revisa que el servicio esté activo.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [setError]);

  return { executions, setExecutions, activeId, setActiveId, loading };
}

type ExecutionSnapshotOptions = {
  activeId: string;
  selectedTaskId: string;
  setTaskDetails: React.Dispatch<React.SetStateAction<TaskDetails | null>>;
  setExecutions: React.Dispatch<React.SetStateAction<ExecutionRecord[]>>;
  setError: (message: string) => void;
};

function useExecutionSnapshot({
  activeId,
  selectedTaskId,
  setTaskDetails,
  setExecutions,
  setError,
}: ExecutionSnapshotOptions) {
  const [details, setDetails] = useState<ExecutionDetails | null>(null);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const selectedTaskIdRef = useRef(selectedTaskId);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  const refreshSnapshot = useCallback(async (id: string, signal?: AbortSignal) => {
    const [nextDetails, nextEvents, nextUsage] = await Promise.all([
      getExecution(id, signal),
      listEvents(id, signal),
      getUsage(id, signal),
    ]);
    setDetails(nextDetails);
    setEvents((current) => mergeEvents(current, nextEvents));
    setUsage(nextUsage);
    return nextDetails;
  }, []);

  useEffect(() => {
    if (!activeId) {
      setDetails(null);
      setEvents([]);
      setUsage(null);
      return;
    }
    const controller = new AbortController();
    setDetails(null);
    setEvents([]);
    setUsage(null);
    setConnection("connecting");
    refreshSnapshot(activeId, controller.signal)
      .then((next) => {
        setExecutions((current) => current.map((item) => (item.id === next.id ? next : item)));
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("No se pudo cargar esta ejecución.");
      });
    return () => controller.abort();
  }, [activeId, refreshSnapshot, setExecutions, setError]);

  useEffect(() => {
    if (!activeId) return;
    const source = createExecutionEventSource(activeId);
    source.onopen = () => {
      setConnection("live");
      void refreshSnapshot(activeId).catch(() => setConnection("offline"));
    };
    source.onerror = () => setConnection("connecting");
    const handleEvent = (message: Event) => {
      const data = (message as MessageEvent<string>).data;
      try {
        const event = JSON.parse(data) as DomainEvent;
        setEvents((current) => mergeEvents(current, [event]));
        if (event.eventType.startsWith("EXECUTION_") || event.eventType.startsWith("TASK_")) {
          void getExecution(activeId)
            .then((next) => {
              setDetails(next);
              setExecutions((current) =>
                current.map((item) => (item.id === next.id ? next : item)),
              );
            })
            .catch(() => setConnection("offline"));
          const selectedTaskId = selectedTaskIdRef.current;
          if (event.taskId === selectedTaskId) {
            void getTaskDetails(activeId, selectedTaskId)
              .then(setTaskDetails)
              .catch(() => undefined);
          }
        }
        if (event.eventType === "session.step.ended" || event.eventType === "session.step.failed") {
          void getUsage(activeId)
            .then(setUsage)
            .catch(() => setConnection("offline"));
        }
      } catch {
        setError("Se recibió un evento con formato no válido.");
      }
    };
    for (const eventType of eventTypes) source.addEventListener(eventType, handleEvent);
    return () => source.close();
  }, [activeId, refreshSnapshot, setExecutions, setError]);

  return { details, events, usage, connection, setConnection, refreshSnapshot };
}

function useTaskSelection(activeId: string, setError: (message: string) => void) {
  const [taskDetails, setTaskDetails] = useState<TaskDetails | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");

  useEffect(() => {
    setSelectedTaskId("");
    setTaskDetails(null);
  }, [activeId]);

  const openTask = useCallback(
    async (taskId: string) => {
      if (!activeId) return;
      setSelectedTaskId(taskId);
      setTaskDetails(null);
      try {
        setTaskDetails(await getTaskDetails(activeId, taskId));
      } catch {
        setError("No se pudo cargar el detalle de la tarea.");
      }
    },
    [activeId, setError],
  );

  return { taskDetails, selectedTaskId, setSelectedTaskId, setTaskDetails, openTask };
}

function BudgetApprovalPanel({
  execution,
  onApproved,
  onCancelled,
}: {
  execution: ExecutionRecord;
  onApproved: () => Promise<void>;
  onCancelled: () => Promise<void>;
}) {
  const [newBudgetUsd, setNewBudgetUsd] = useState(
    Math.min(1000, Number(((execution.budgetUsd ?? 0) + 10).toFixed(2))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (execution.status !== "PAUSED_BUDGET") return null;

  return (
    <form
      className="budget-approval-panel"
      onSubmit={(event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        void approveExecutionBudget(execution.id, newBudgetUsd)
          .then(onApproved)
          .catch((failure: unknown) =>
            setError(failure instanceof Error ? failure.message : "No se pudo aprobar el límite."),
          )
          .finally(() => setSaving(false));
      }}
    >
      <div>
        <strong>Presupuesto alcanzado</strong>
        <p>La ejecución está pausada. Aumenta el límite para reanudar las tareas pendientes.</p>
      </div>
      <label>
        Nuevo límite (USD)
        <input
          aria-label="Nuevo límite de presupuesto en USD"
          type="number"
          min={Number(((execution.budgetUsd ?? 0) + 0.01).toFixed(2))}
          max="1000"
          step="0.01"
          value={newBudgetUsd}
          onChange={(event) => setNewBudgetUsd(Number(event.target.value))}
          required
        />
      </label>
      <button type="submit" disabled={saving || newBudgetUsd <= (execution.budgetUsd ?? 0)}>
        {saving ? "Reanudando…" : "Aprobar y reanudar"}
      </button>
      <button
        className="budget-cancel-button"
        type="button"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setError("");
          void cancelExecution(execution.id)
            .then(onCancelled)
            .catch((failure: unknown) =>
              setError(failure instanceof Error ? failure.message : "No se pudo cancelar."),
            )
            .finally(() => setSaving(false));
        }}
      >
        Cancelar ejecución
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}

export function Dashboard() {
  const [error, setError] = useState("");
  const catalog = useExecutionCatalog(setError);
  const taskSelection = useTaskSelection(catalog.activeId, setError);
  const snapshot = useExecutionSnapshot({
    activeId: catalog.activeId,
    selectedTaskId: taskSelection.selectedTaskId,
    setTaskDetails: taskSelection.setTaskDetails,
    setExecutions: catalog.setExecutions,
    setError,
  });

  const activeExecution = useMemo(
    () =>
      catalog.executions.find((execution) => execution.id === catalog.activeId) ?? snapshot.details,
    [catalog.activeId, catalog.executions, snapshot.details],
  );

  const counts = useMemo(() => {
    const tasks = snapshot.details?.tasks ?? [];
    return {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "COMPLETED").length,
      active: tasks.filter((task) => task.status === "RUNNING").length,
    };
  }, [snapshot.details?.tasks]);
  const activeDetails = snapshot.details;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">P</div>
          <div>
            <strong>punku</strong>
            <span>TECH / ENGINEERING</span>
          </div>
        </div>
        <div className="sidebar-heading">
          <span>WORKSPACE</span>
          <span className="workspace-dot" />
        </div>
        <nav className="workspace-nav" aria-label="Navegación">
          <a className="nav-link selected" href="#board">
            <span className="nav-glyph">▦</span>Agent board
          </a>
          <a className="nav-link" href="#projects">
            <span className="nav-glyph">▧</span>Proyectos
          </a>
          <a className="nav-link disabled" href="#timeline" aria-disabled="true">
            <span className="nav-glyph">◷</span>Actividad
          </a>
        </nav>
        <div className="sidebar-divider" />
        <div className="execution-heading">
          <span>EJECUCIONES</span>
          <span className="execution-count">{catalog.executions.length}</span>
        </div>
        <div className="execution-list">
          {catalog.executions.map((execution) => (
            <button
              className={`execution-item ${catalog.activeId === execution.id ? "current" : ""}`}
              key={execution.id}
              onClick={() => catalog.setActiveId(execution.id)}
              type="button"
            >
              <span className={`execution-indicator ${statusTone(execution.status)}`} />
              <span className="execution-item-copy">
                <strong>{redactSensitiveText(execution.name)}</strong>
                <small>
                  {shortId(execution.id)} · {timeAgo(execution.createdAt)}
                </small>
              </span>
              <span className="execution-chevron">›</span>
            </button>
          ))}
          {!catalog.loading && catalog.executions.length === 0 && (
            <p className="sidebar-empty">Las ejecuciones aparecerán aquí.</p>
          )}
        </div>
        <div className="sidebar-footer">
          <span className={`connection-led ${snapshot.connection}`} />
          API local <span className="footer-version">MVP 0.1</span>
        </div>
      </aside>

      <main className="main-area" id="board">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Agent Board</strong>
          </div>
          <div className="topbar-right">
            <span className={`live-pill ${snapshot.connection}`}>
              <i />
              {snapshot.connection === "live"
                ? "EN VIVO"
                : snapshot.connection === "offline"
                  ? "SIN CONEXIÓN"
                  : "CONECTANDO"}
            </span>
            <div className="avatar">P</div>
          </div>
        </header>

        <ProjectWorkspace />

        <div className="content-grid">
          <section className="board-column">
            <div className="page-intro">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-line" />
                  OPERACIONES
                </div>
                <h1>
                  Agent Board<span className="title-period">.</span>
                </h1>
                <p>Vista en tiempo real de tus agentes y su trabajo.</p>
              </div>
              <button
                className="refresh-button"
                type="button"
                onClick={() =>
                  catalog.activeId &&
                  void snapshot
                    .refreshSnapshot(catalog.activeId)
                    .catch(() => setError("No se pudo actualizar la ejecución."))
                }
                aria-label="Actualizar tablero"
              >
                ↻
              </button>
            </div>

            {error && (
              <div className="notice" role="status">
                <span>!</span>
                {error}
                <button type="button" onClick={() => setError("")}>
                  Cerrar
                </button>
              </div>
            )}

            {catalog.loading && !activeExecution ? (
              <div className="loading-state">
                <span className="loader" />
                Cargando ejecuciones…
              </div>
            ) : null}
            {activeExecution && !snapshot.details && (
              <div className="loading-state">
                <span className="loader" />
                Cargando ejecución…
              </div>
            )}
            {!catalog.loading && catalog.executions.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✳</span>
                <h2>Aún no hay ejecuciones</h2>
                <p>Cuando la API reciba una ejecución, los agentes y sus tareas aparecerán aquí.</p>
                <code>POST /api/executions</code>
              </div>
            ) : null}

            {activeExecution && activeDetails && (
              <>
                <div className="execution-overview">
                  <div className="overview-main">
                    <span className="overview-label">EJECUCIÓN ACTUAL</span>
                    <h2>{redactSensitiveText(activeDetails.name)}</h2>
                    <p>{redactSensitiveText(activeDetails.requirement)}</p>
                    <div className="overview-meta">
                      <span>
                        <b className={`status-dot ${statusTone(activeDetails.status)}`} />
                        {statusLabel(activeDetails.status)}
                      </span>
                      <span>
                        Iniciada {formatDate(activeDetails.startedAt ?? activeDetails.createdAt)}
                      </span>
                      {activeDetails.workspaceBranch ? (
                        <span>
                          Rama <code>{activeDetails.workspaceBranch}</code>
                        </span>
                      ) : null}
                      <span>ID {shortId(activeDetails.id)}</span>
                    </div>
                  </div>
                  <div className="overview-stats">
                    <div>
                      <strong>{counts.total.toString().padStart(2, "0")}</strong>
                      <span>TAREAS</span>
                    </div>
                    <div>
                      <strong>{counts.active.toString().padStart(2, "0")}</strong>
                      <span>ACTIVAS</span>
                    </div>
                    <div>
                      <strong>{counts.completed.toString().padStart(2, "0")}</strong>
                      <span>LISTAS</span>
                    </div>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${counts.total ? (counts.completed / counts.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <BudgetApprovalPanel
                  execution={activeDetails}
                  onApproved={async () => {
                    await snapshot.refreshSnapshot(activeDetails.id);
                  }}
                  onCancelled={async () => {
                    await snapshot.refreshSnapshot(activeDetails.id);
                  }}
                />

                <UsagePanel usage={snapshot.usage} />

                <div className="section-heading">
                  <div>
                    <span className="section-kicker">EQUIPO</span>
                    <h2>
                      Agentes <span>06</span>
                    </h2>
                  </div>
                  <span className="section-caption">Estado de trabajo actual</span>
                </div>
                <div className="agent-grid">
                  {boardAgents.map((agent) => (
                    <AgentCard
                      agent={agent}
                      key={agent.id}
                      tasks={agentTasks(agent, activeDetails.tasks)}
                      onTaskClick={taskSelection.openTask}
                    />
                  ))}
                </div>
                {taskSelection.selectedTaskId && (
                  <TaskPanel
                    task={taskSelection.taskDetails}
                    loading={!taskSelection.taskDetails}
                    onClose={() => taskSelection.setSelectedTaskId("")}
                  />
                )}
              </>
            )}
          </section>

          <aside className="timeline-column" id="timeline">
            <div className="timeline-header">
              <div>
                <span className="section-kicker">SEGUIMIENTO</span>
                <h2>Timeline</h2>
              </div>
              <span className="timeline-total">
                {snapshot.events.length.toString().padStart(2, "0")}
              </span>
            </div>
            <div className="timeline-caption">Eventos de ejecución</div>
            <div className="timeline-list">
              {snapshot.events.length === 0 && (
                <div className="timeline-empty">
                  <span>◷</span>
                  <p>Los eventos aparecerán mientras avance la ejecución.</p>
                </div>
              )}
              {[...snapshot.events].reverse().map((event) => (
                <TimelineItem event={event} key={event.eventId} />
              ))}
            </div>
            <div className="timeline-footer">
              <span className={`connection-led ${snapshot.connection}`} />
              {snapshot.connection === "live"
                ? "Conectado · reconexión automática"
                : "Esperando conexión"}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function AgentCard({
  agent,
  tasks,
  onTaskClick,
}: {
  agent: AgentDefinition;
  tasks: TaskRecord[];
  onTaskClick: (taskId: string) => void;
}) {
  const presentation = getAgentPresentation(tasks);
  const current = taskForAgent(tasks);

  return (
    <article className={`agent-card ${presentation.isRunning ? "agent-running" : ""}`}>
      <div className="agent-card-top">
        <div className={`agent-avatar ${agent.color}`}>{agent.short}</div>
        <span className={`agent-status ${presentation.tone}`}>
          <i />
          {presentation.label}
        </span>
      </div>
      <div className="agent-title-row">
        <h3>{agent.label}</h3>
        <span className="task-count">
          {presentation.done}/{tasks.length} tareas
        </span>
      </div>
      <div className="agent-progress">
        <span
          style={{ width: `${tasks.length ? (presentation.done / tasks.length) * 100 : 0}%` }}
        />
      </div>
      {current ? (
        <button className="agent-task" type="button" onClick={() => onTaskClick(current.id)}>
          <span className="task-status-mark">
            {current.status === "RUNNING" ? (
              <i className="pulse" />
            ) : current.status === "COMPLETED" ? (
              "✓"
            ) : (
              "·"
            )}
          </span>
          <span className="task-copy">
            <small>TAREA {String(current.sequence + 1).padStart(2, "0")}</small>
            <strong>{redactSensitiveText(current.title)}</strong>
          </span>
          <span className="task-open">↗</span>
        </button>
      ) : (
        <div className="agent-idle">
          <span>—</span>Sin tareas asignadas
        </div>
      )}
      {tasks.length > 1 && (
        <div className="agent-extra">
          + {tasks.length - 1} tarea{tasks.length > 2 ? "s" : ""} adicional
          {tasks.length > 2 ? "es" : ""}
        </div>
      )}
    </article>
  );
}

function getAgentPresentation(tasks: TaskRecord[]) {
  const done = tasks.filter((task) => task.status === "COMPLETED").length;
  const isRunning = tasks.some((task) => task.status === "RUNNING");
  const hasIssue = tasks.some((task) => task.status === "FAILED" || task.status === "BLOCKED");
  const isComplete = tasks.length > 0 && done === tasks.length;
  let tone = "waiting";
  let label = "PENDIENTE";
  if (isRunning) {
    tone = "active";
    label = "EN CURSO";
  } else if (tasks.length === 0) {
    label = "EN ESPERA";
  } else if (isComplete) {
    tone = "success";
    label = "COMPLETADO";
  } else if (hasIssue) {
    tone = "danger";
    label = "REVISAR";
  }
  return { done, isRunning, tone, label };
}

function TimelineItem({ event }: { event: DomainEvent }) {
  const eventName =
    eventNames[event.eventType] ?? event.eventType.replaceAll("_", " ").replaceAll(".", " · ");
  return (
    <article className="timeline-event">
      <div
        className={`timeline-marker ${event.eventType.includes("FAILED") ? "danger" : event.eventType.includes("COMPLETED") || event.eventType.includes("succeeded") ? "success" : ""}`}
      >
        <span />
      </div>
      <div className="event-content">
        <div className="event-title">
          <strong>{eventName}</strong>
          <time>{timeAgo(event.occurredAt)}</time>
        </div>
        <div className="event-meta">
          {event.agentId ?? event.source}
          {event.taskId ? ` · tarea ${shortId(event.taskId)}` : ""}
        </div>
      </div>
    </article>
  );
}

function TaskPanel({
  task,
  loading,
  onClose,
}: {
  task: TaskDetails | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <section className="task-panel" aria-label="Detalle de tarea">
      <div className="task-panel-head">
        <div>
          <span className="section-kicker">DETALLE DE TAREA</span>
          <h2>{loading ? "Cargando tarea…" : task ? redactSensitiveText(task.title) : ""}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar detalle">
          ×
        </button>
      </div>
      {task && (
        <>
          <div className="task-panel-meta">
            <span className={`status-chip ${statusTone(task.status)}`}>
              {statusLabel(task.status)}
            </span>
            <span>{task.agentId}</span>
            <span>Actualizada {formatDate(task.finishedAt ?? task.startedAt)}</span>
          </div>
          <p className="task-description">{redactSensitiveText(task.description)}</p>
          {task.summary && (
            <div className="deliverable-block">
              <h3>Resumen del agente</h3>
              <p>{redactSensitiveText(task.summary)}</p>
            </div>
          )}
          <div className="deliverable-block">
            <h3>
              Entregables <span>{task.artifactPaths.length}</span>
            </h3>
            {task.artifactPaths.length ? (
              <ul className="artifact-list">
                {task.artifactPaths.map((path) => (
                  <li key={path}>
                    <span>↗</span>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-copy">No hay rutas de artefactos registradas.</p>
            )}
          </div>
          <div className="deliverable-block">
            <h3>Criterios de aceptación</h3>
            <ul className="criteria-list">
              {task.acceptanceCriteria.map((criterion) => (
                <li key={criterion}>
                  <span>✓</span>
                  {redactSensitiveText(criterion)}
                </li>
              ))}
            </ul>
          </div>
          <div className="task-events">
            <h3>
              Eventos de la tarea <span>{task.events.length}</span>
            </h3>
            {task.events.length ? (
              [...task.events].reverse().map((event) => (
                <div className="task-event-row" key={event.eventId}>
                  <span>{eventNames[event.eventType] ?? event.eventType.replaceAll("_", " ")}</span>
                  <time>{formatDate(event.occurredAt)}</time>
                </div>
              ))
            ) : (
              <p className="muted-copy">No hay eventos de tarea todavía.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
