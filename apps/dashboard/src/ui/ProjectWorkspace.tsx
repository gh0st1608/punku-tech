import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  CreateProjectRequest,
  ProjectPriority,
  ProjectRecord,
  ProjectStatus,
} from "@aief/contracts";
import { projectPriorities, projectStatuses } from "@aief/contracts";
import { createProject, deleteProject, listProjects, updateProject } from "../api";

const statusLabels: Record<ProjectStatus, string> = {
  PLANNING: "Planificación",
  ACTIVE: "Activo",
  ON_HOLD: "En pausa",
  COMPLETED: "Completado",
};

const priorityLabels: Record<ProjectPriority, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

const emptyProject: CreateProjectRequest = {
  name: "",
  description: "",
  status: "PLANNING",
  priority: "MEDIUM",
};

function projectDate(value: string): string {
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium" }).format(new Date(value));
}

export function ProjectWorkspace() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreateProjectRequest>(emptyProject);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setProjects(await listProjects(signal));
      setError("");
    } catch (loadError) {
      if (!signal?.aborted)
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la lista.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  function startCreate() {
    setDraft(emptyProject);
    setEditingId(null);
    setFormOpen(true);
    setError("");
  }

  function startEdit(project: ProjectRecord) {
    setDraft({
      name: project.name,
      description: project.description ?? "",
      status: project.status,
      priority: project.priority,
    });
    setEditingId(project.id);
    setFormOpen(true);
    setError("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyProject);
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingId) await updateProject(editingId, draft);
      else await createProject(draft);
      closeForm();
      await refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el proyecto.");
    } finally {
      setSaving(false);
    }
  }

  async function removeProject(project: ProjectRecord) {
    if (
      !window.confirm(`¿Eliminar el proyecto “${project.name}”? Esta acción no se puede deshacer.`)
    ) {
      return;
    }
    setError("");
    try {
      await deleteProject(project.id);
      if (editingId === project.id) closeForm();
      await refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el proyecto.",
      );
    }
  }

  return (
    <section className="projects-panel" id="projects" aria-labelledby="projects-title">
      <div className="projects-heading">
        <div>
          <span className="section-kicker">ESPACIO DE TRABAJO</span>
          <h2 id="projects-title">
            Proyectos <span>{projects.length.toString().padStart(2, "0")}</span>
          </h2>
          <p>Organiza proyectos y actualiza su estado y prioridad.</p>
        </div>
        <button className="project-primary-button" onClick={startCreate} type="button">
          <span aria-hidden="true">＋</span> Nuevo proyecto
        </button>
      </div>

      {error && (
        <div className="project-notice" role="alert">
          {error}
        </div>
      )}

      {formOpen && (
        <form className="project-form" onSubmit={(event) => void saveProject(event)}>
          <div className="project-form-heading">
            <strong>{editingId ? "Editar proyecto" : "Crear proyecto"}</strong>
            <span>Los campos con * son obligatorios.</span>
          </div>
          <label>
            Nombre *
            <input
              autoFocus
              maxLength={120}
              minLength={2}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
              value={draft.name}
            />
          </label>
          <label className="project-description-field">
            Descripción
            <textarea
              maxLength={2000}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              rows={3}
              value={draft.description ?? ""}
            />
          </label>
          <label>
            Estado
            <select
              onChange={(event) =>
                setDraft({ ...draft, status: event.target.value as ProjectStatus })
              }
              value={draft.status ?? "PLANNING"}
            >
              {projectStatuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioridad
            <select
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as ProjectPriority })
              }
              value={draft.priority ?? "MEDIUM"}
            >
              {projectPriorities.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabels[priority]}
                </option>
              ))}
            </select>
          </label>
          <div className="project-form-actions">
            <button className="project-secondary-button" onClick={closeForm} type="button">
              Cancelar
            </button>
            <button className="project-primary-button" disabled={saving} type="submit">
              {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear proyecto"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="projects-empty">Cargando proyectos…</p>
      ) : projects.length === 0 ? (
        <div className="projects-empty">
          <strong>Aún no hay proyectos</strong>
          <span>Crea uno para organizar el trabajo del equipo.</span>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-card-heading">
                <div>
                  <span className={`project-status status-${project.status.toLowerCase()}`}>
                    {statusLabels[project.status]}
                  </span>
                  <h3>{project.name}</h3>
                </div>
                <span className={`project-priority priority-${project.priority.toLowerCase()}`}>
                  {priorityLabels[project.priority]}
                </span>
              </div>
              <p className="project-card-description">
                {project.description || "Sin descripción."}
              </p>
              <div className="project-card-footer">
                <span>Actualizado {projectDate(project.updatedAt)}</span>
                <div>
                  <button onClick={() => startEdit(project)} type="button">
                    Editar
                  </button>
                  <button
                    className="project-delete-button"
                    onClick={() => void removeProject(project)}
                    type="button"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
