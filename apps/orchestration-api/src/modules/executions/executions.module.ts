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

@Module({
  imports: [PrismaModule, OpenCodeModule],
  controllers: [ExecutionsController],
  providers: [
    PrismaExecutionsRepository,
    ExecutionExistsGuard,
    { provide: EXECUTIONS_REPOSITORY, useExisting: PrismaExecutionsRepository },
    {
      provide: ExecutionsService,
      useFactory: (
        repository: ExecutionsRepository,
        environment: AppEnvironment,
        openCode: OpenCodeGateway,
      ) => new ExecutionsService(repository, environment, openCode),
      inject: [EXECUTIONS_REPOSITORY, APP_ENVIRONMENT, OPENCODE_GATEWAY],
    },
  ],
})
export class ExecutionsModule {}
