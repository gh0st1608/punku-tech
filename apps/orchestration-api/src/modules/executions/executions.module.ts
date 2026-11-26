import { Module } from "@nestjs/common";
import { APP_ENVIRONMENT } from "../../config/app-environment";
import type { AppEnvironment } from "../../config/app-environment";
import { PrismaModule } from "../prisma/prisma.module";
import { ExecutionsService } from "./application/executions.service";
import type { ExecutionsRepository } from "./application/executions.repository";
import { EXECUTIONS_REPOSITORY } from "./application/executions.repository";
import { PrismaExecutionsRepository } from "./infrastructure/prisma-executions.repository";
import { ExecutionsController } from "./presentation/executions.controller";
import { ExecutionExistsGuard } from "./presentation/execution-exists.guard";
import { OpenCodeModule } from "../opencode/opencode.module";
import { OPENCODE_GATEWAY } from "../opencode/application/opencode.gateway";
import type { OpenCodeGateway } from "../opencode/application/opencode.gateway";
import { GitWorktreeManager } from "./infrastructure/git-worktree.manager";

@Module({
  imports: [PrismaModule, OpenCodeModule],
  controllers: [ExecutionsController],
  providers: [
    PrismaExecutionsRepository,
    {
      provide: GitWorktreeManager,
      useFactory: (environment: AppEnvironment) => new GitWorktreeManager(environment),
      inject: [APP_ENVIRONMENT],
    },
    ExecutionExistsGuard,
    { provide: EXECUTIONS_REPOSITORY, useExisting: PrismaExecutionsRepository },
    {
      provide: ExecutionsService,
      useFactory: (
        repository: ExecutionsRepository,
        environment: AppEnvironment,
        openCode: OpenCodeGateway,
        worktrees: GitWorktreeManager,
      ) => new ExecutionsService(repository, environment, openCode, worktrees),
      inject: [EXECUTIONS_REPOSITORY, APP_ENVIRONMENT, OPENCODE_GATEWAY, GitWorktreeManager],
    },
  ],
})
export class ExecutionsModule {}
