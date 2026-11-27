import { Logger } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { setTimeout as delay } from "node:timers/promises";
import type { OpenCodeGateway } from "../../opencode/application/opencode.gateway";
import type { OpenCodeSessionEvent } from "../../opencode/application/opencode.gateway";
import type { ExecutionsRepository } from "./executions.repository";
import { estimateUsageCost, findModelTariff, type ModelTariff } from "./model-tariffs";

export class OpenCodeSessionEventConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OpenCodeSessionEventConsumer.name);
  private readonly abortController = new AbortController();

  constructor(
    private readonly repository: ExecutionsRepository,
    private readonly openCode: OpenCodeGateway,
    private readonly modelTariffs: ModelTariff[] = [],
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
          await this.repository.persistSessionEvent(await this.withUsageDetails(event));
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

  private async withUsageDetails(event: OpenCodeSessionEvent): Promise<OpenCodeSessionEvent> {
    if (!event.usage) return event;

    const model = this.openCode.assistantMessageModel
      ? await this.openCode
          .assistantMessageModel(event.sessionId, event.usage.messageId)
          .catch(() => null)
      : null;
    const provider = model?.provider ?? null;
    const modelId = model?.model ?? null;
    const tariff = findModelTariff(this.modelTariffs, provider, modelId);
    const usage = {
      ...event.usage,
      provider,
      model: modelId,
      estimatedCostUsd:
        event.usage.reportedCostUsd === null && tariff
          ? estimateUsageCost(tariff, event.usage)
          : null,
      rateVersion: tariff?.version ?? null,
    };

    return { ...event, usage };
  }
}
