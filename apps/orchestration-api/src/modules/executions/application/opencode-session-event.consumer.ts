import { Logger } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
import type { OpenCodeGateway } from "../../opencode/application/opencode.gateway";
import type { ExecutionsRepository } from "./executions.repository";

export class OpenCodeSessionEventConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OpenCodeSessionEventConsumer.name);
  private readonly abortController = new AbortController();

  constructor(
    private readonly repository: ExecutionsRepository,
    private readonly openCode: OpenCodeGateway,
  ) {}

  onApplicationBootstrap(): void {
    void this.consume();
  }

  onApplicationShutdown(): void {
    this.abortController.abort();
  }

  private async consume(): Promise<void> {
    let retryDelayMs = 1000;
    const { signal } = this.abortController;

    while (!signal.aborted) {
      try {
        for await (const event of this.openCode.subscribeSessionEvents(signal)) {
          await this.repository.persistSessionEvent(event);
        }
      } catch {
        if (signal.aborted) return;
        this.logger.warn("OpenCode event stream disconnected; reconnecting.");
      }

      try {
        await delay(retryDelayMs, undefined, { signal });
      } catch {
        return;
      }
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    }
  }
}
