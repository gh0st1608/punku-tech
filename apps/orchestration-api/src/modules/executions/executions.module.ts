import { Module } from "@nestjs/common";
import { APP_ENVIRONMENT } from "../../config/app-environment";
import type { AppEnvironment } from "../../config/app-environment";
import { PrismaModule } from "../prisma/prisma.module";
import { ExecutionsService } from "./application/executions.service";
import { EXECUTIONS_REPOSITORY, ExecutionsRepository } from "./application/executions.repository";
import { PrismaExecutionsRepository } from "./infrastructure/prisma-executions.repository";
import { ExecutionsController } from "./presentation/executions.controller";
import { ExecutionExistsGuard } from "./presentation/execution-exists.guard";

@Module({
  imports: [PrismaModule],
  controllers: [ExecutionsController],
  providers: [
    PrismaExecutionsRepository,
    ExecutionExistsGuard,
    { provide: EXECUTIONS_REPOSITORY, useExisting: PrismaExecutionsRepository },
    {
      provide: ExecutionsService,
      useFactory: (repository: ExecutionsRepository, environment: AppEnvironment) =>
        new ExecutionsService(repository, environment),
      inject: [EXECUTIONS_REPOSITORY, APP_ENVIRONMENT],
    },
  ],
})
export class ExecutionsModule {}
