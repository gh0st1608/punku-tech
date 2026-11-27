import "reflect-metadata";
import { config as loadDotEnv } from "dotenv";
import { resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { AppEnvironment } from "./config/app-environment";
import { APP_ENVIRONMENT } from "./config/app-environment";
import { AppModule } from "./modules/app.module";
import { ExecutionNotFoundFilter } from "./modules/executions/presentation/execution-not-found.filter";

loadDotEnv({ path: resolve(__dirname, "../../../.env") });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const environment = app.get<AppEnvironment>(APP_ENVIRONMENT);

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: environment.corsOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Last-Event-ID"],
    credentials: false,
    maxAge: 600,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new ExecutionNotFoundFilter());
  app.enableShutdownHooks();
  await app.listen(environment.apiPort, "127.0.0.1");
}

void bootstrap().catch((error: unknown) => {
  if (error instanceof Error && error.message.startsWith("Invalid configuration:")) {
    console.error(error.message);
  } else {
    console.error(
      "API failed to start. Check the required configuration and database availability.",
    );
  }
  process.exitCode = 1;
});
