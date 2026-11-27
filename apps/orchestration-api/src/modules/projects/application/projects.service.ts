import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { CreateProjectRequest, ProjectRecord, UpdateProjectRequest } from "@aief/contracts";
import { ProjectNotFoundError } from "./project-not-found.error";
import { PROJECTS_REPOSITORY } from "./projects.repository";
import type { ProjectsRepository } from "./projects.repository";

@Injectable()
export class ProjectsService {
  constructor(@Inject(PROJECTS_REPOSITORY) private readonly repository: ProjectsRepository) {}

  create(input: CreateProjectRequest): Promise<ProjectRecord> {
    const name = input.name.trim();
    if (name.length < 2)
      throw new BadRequestException("Project name must have at least 2 characters");
    return this.repository.create({
      ...input,
      name,
      description: input.description?.trim() || undefined,
    });
  }

  list(): Promise<ProjectRecord[]> {
    return this.repository.list();
  }

  async get(id: string): Promise<ProjectRecord> {
    const project = await this.repository.find(id);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }

  async update(id: string, input: UpdateProjectRequest): Promise<ProjectRecord> {
    if (Object.keys(input).length === 0)
      throw new BadRequestException("At least one field is required");
    const name = input.name?.trim();
    if (name !== undefined && name.length < 2) {
      throw new BadRequestException("Project name must have at least 2 characters");
    }
    const update = {
      ...input,
      ...(name !== undefined ? { name } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
    };
    const project = await this.repository.update(id, update);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repository.delete(id))) throw new ProjectNotFoundError();
  }
}
