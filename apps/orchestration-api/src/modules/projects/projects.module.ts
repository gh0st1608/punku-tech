import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PROJECTS_REPOSITORY } from "./application/projects.repository";
import { ProjectsService } from "./application/projects.service";
import { PrismaProjectsRepository } from "./infrastructure/prisma-projects.repository";
import { ProjectsController } from "./presentation/projects.controller";

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController],
  providers: [
    PrismaProjectsRepository,
    { provide: PROJECTS_REPOSITORY, useExisting: PrismaProjectsRepository },
    ProjectsService,
  ],
})
export class ProjectsModule {}
