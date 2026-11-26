import { Module } from "@nestjs/common";
import { APP_ENVIRONMENT } from "../../config/app-environment";
import type { AppEnvironment } from "../../config/app-environment";
import { OPENCODE_GATEWAY } from "./application/opencode.gateway";
import { OpenCodeApiAdapter } from "./infrastructure/opencode-api.adapter";
import { OpenCodeController } from "./presentation/opencode.controller";

@Module({
  controllers: [OpenCodeController],
  providers: [
    {
      provide: OpenCodeApiAdapter,
      useFactory: (environment: AppEnvironment) => new OpenCodeApiAdapter(environment),
      inject: [APP_ENVIRONMENT],
    },
    { provide: OPENCODE_GATEWAY, useExisting: OpenCodeApiAdapter },
  ],
  exports: [OPENCODE_GATEWAY],
})
export class OpenCodeModule {}
