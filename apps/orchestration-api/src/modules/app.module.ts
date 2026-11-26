import { Module } from "@nestjs/common";
import { EnvironmentModule } from "../config/environment.module";
import { ExecutionsModule } from "./executions/executions.module";

@Module({ imports: [EnvironmentModule, ExecutionsModule] })
export class AppModule {}
