import type { CreateProjectRequest, ProjectRecord, UpdateProjectRequest } from "@aief/contracts";

export const PROJECTS_REPOSITORY = Symbol("PROJECTS_REPOSITORY");

export interface ProjectsRepository {
  create(input: CreateProjectRequest): Promise<ProjectRecord>;
  list(): Promise<ProjectRecord[]>;
  find(id: string): Promise<ProjectRecord | null>;
  update(id: string, input: UpdateProjectRequest): Promise<ProjectRecord | null>;
  delete(id: string): Promise<boolean>;
}
