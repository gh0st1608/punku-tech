import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import type { AppEnvironment } from "../../config/app-environment";
import { APP_ENVIRONMENT } from "../../config/app-environment";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    super({ datasources: { db: { url: environment.databaseUrl } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
