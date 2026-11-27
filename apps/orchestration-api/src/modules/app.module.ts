import { Module } from "@nestjs/common";
import { EnvironmentModule } from "../config/environment.module";
import { ExecutionsModule } from "./executions/executions.module";
import { OpenCodeModule } from "./opencode/opencode.module";
import { ProjectsModule } from "./projects/projects.module";

@Module({ imports: [EnvironmentModule, OpenCodeModule, ExecutionsModule, ProjectsModule] })
export class AppModule {}
