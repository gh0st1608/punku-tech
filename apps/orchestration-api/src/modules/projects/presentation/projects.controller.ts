import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import type { CreateProjectRequest, UpdateProjectRequest } from "@aief/contracts";
import { ProjectNotFoundError } from "../application/project-not-found.error";
import { ProjectsService } from "../application/projects.service";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { UpdateProjectDto } from "./dto/update-project.dto";

@Controller("projects")
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Post()
  create(@Body() body: CreateProjectDto) {
    return this.projects.create(body satisfies CreateProjectRequest);
  }

  @Get()
  list() {
    return this.projects.list();
  }

  @Get(":id")
  get(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.projects.get(id).catch((error: unknown) => {
      if (error instanceof ProjectNotFoundError) throw new NotFoundException("Project not found");
      throw error;
    });
  }

  @Patch(":id")
  update(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: UpdateProjectDto) {
    return this.projects.update(id, body satisfies UpdateProjectRequest).catch((error: unknown) => {
      if (error instanceof ProjectNotFoundError) throw new NotFoundException("Project not found");
      throw error;
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param("id", new ParseUUIDPipe()) id: string): Promise<void> {
    try {
      await this.projects.delete(id);
    } catch (error) {
      if (error instanceof ProjectNotFoundError) throw new NotFoundException("Project not found");
      throw error;
    }
  }
}
