import { Inject, Injectable } from "@nestjs/common";
import type { CreateProjectRequest, ProjectRecord, UpdateProjectRequest } from "@aief/contracts";
import type { ProjectsRepository } from "../application/projects.repository";
import { PrismaService } from "../../prisma/prisma.service";

function toProjectRecord(row: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
}): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as ProjectRecord["status"],
    priority: row.priority as ProjectRecord["priority"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class PrismaProjectsRepository implements ProjectsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateProjectRequest): Promise<ProjectRecord> {
    const row = await this.prisma.project.create({
      data: {
        name: input.name,
        description: input.description || null,
        status: input.status,
        priority: input.priority,
      },
    });
    return toProjectRecord(row);
  }

  async list(): Promise<ProjectRecord[]> {
    const rows = await this.prisma.project.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return rows.map(toProjectRecord);
  }

  async find(id: string): Promise<ProjectRecord | null> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    return row ? toProjectRecord(row) : null;
  }

  async update(id: string, input: UpdateProjectRequest): Promise<ProjectRecord | null> {
    const result = await this.prisma.project.updateMany({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      },
    });
    if (result.count === 0) return null;
    return this.find(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.prisma.project.deleteMany({ where: { id } });
    return result.count > 0;
  }
}
