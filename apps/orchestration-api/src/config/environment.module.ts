import { Global, Module } from "@nestjs/common";
import { APP_ENVIRONMENT, loadAppEnvironment } from "./app-environment";

@Global()
@Module({
  providers: [{ provide: APP_ENVIRONMENT, useFactory: loadAppEnvironment }],
  exports: [APP_ENVIRONMENT],
})
export class EnvironmentModule {}
