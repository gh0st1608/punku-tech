import type { UsageRecordForSummary } from "@aief/contracts";
import {
  estimateUsageCost,
  findModelTariff,
  parseModelTariffs,
} from "../src/modules/executions/application/model-tariffs";
import { summarizeUsage } from "../src/modules/executions/application/usage-summary";

const providerId = "provider-a";
const modelId = "model-a";
const tariffConfig = [
  {
    provider: providerId,
    model: modelId,
    version: "2026-01",
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 2,
    reasoningUsdPerMillionTokens: 3,
    cacheReadUsdPerMillionTokens: 0.5,
    cacheWriteUsdPerMillionTokens: 0.75,
  },
];

function usageRecord(overrides: Partial<UsageRecordForSummary> = {}): UsageRecordForSummary {
  return {
    messageId: "message-1",
    taskId: "task-1",
    agentId: "backend",
    provider: providerId,
    model: modelId,
    recordedAt: "2026-11-27T00:00:00.000Z",
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    reasoningTokens: 100_000,
    cacheReadTokens: 200_000,
    cacheWriteTokens: 50_000,
    reportedCostUsd: null,
    estimatedCostUsd: 2.4375,
    costStatus: "ESTIMATED",
    rateVersion: "2026-01",
    ...overrides,
  };
}

describe("execution usage and cost summaries", () => {
  it("parses versioned tariffs and estimates each token category at its own rate", () => {
    const tariffs = parseModelTariffs(JSON.stringify(tariffConfig));
    const tariff = findModelTariff(tariffs, providerId, modelId);

    expect(tariff?.version).toBe("2026-01");
    if (!tariff) throw new Error("Expected the configured tariff to be found.");
    expect(
      estimateUsageCost(tariff, {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        reasoningTokens: 100_000,
        cacheReadTokens: 200_000,
        cacheWriteTokens: 50_000,
      }),
    ).toBe(2.4375);
  });

  it("leaves estimation unavailable when model or any required token category is unknown", () => {
    const tariffs = parseModelTariffs(JSON.stringify(tariffConfig));
    const tariff = findModelTariff(tariffs, providerId, modelId);

    expect(findModelTariff(tariffs, providerId, "unknown-model")).toBeNull();
    if (!tariff) throw new Error("Expected the configured tariff to be found.");
    expect(
      estimateUsageCost(tariff, {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
        cacheReadTokens: null,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });

  it("rejects malformed and duplicate tariff versions", () => {
    expect(() => parseModelTariffs("not-json")).toThrow("must contain a JSON array");
    expect(() => parseModelTariffs(JSON.stringify([...tariffConfig, ...tariffConfig]))).toThrow(
      "contains duplicate versions",
    );
  });

  it("aggregates usage records and keeps reported and estimated costs separate", () => {
    const rows = [
      usageRecord(),
      usageRecord({
        messageId: "message-2",
        taskId: "task-2",
        agentId: "frontend",
        reportedCostUsd: 0.25,
        estimatedCostUsd: null,
        costStatus: "REPORTED",
        rateVersion: null,
      }),
    ];

    const summary = summarizeUsage(rows);

    expect(summary.turns).toBe(2);
    expect(summary.inputTokens).toBe(2_000_000);
    expect(summary.reportedCostUsd).toBe(0.25);
    expect(summary.estimatedCostUsd).toBe(2.4375);
    expect(summary.costStatus).toBe("MIXED");
    expect(summary.byAgent).toHaveLength(2);
    expect(summary.byTask).toHaveLength(2);
    expect(summary.byModel).toHaveLength(1);
    expect(summary.byModel[0]?.turns).toBe(2);
    expect(summary.byModel[0]?.rateVersions).toEqual(["2026-01"]);
  });

  it("marks partial token and unavailable cost data without inventing zeroes", () => {
    const summary = summarizeUsage([
      usageRecord({
        inputTokens: null,
        outputTokens: 12,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        estimatedCostUsd: null,
        costStatus: "UNAVAILABLE",
        rateVersion: null,
      }),
    ]);

    expect(summary.tokenAvailability).toBe("PARTIAL");
    expect(summary.inputTokens).toBeNull();
    expect(summary.outputTokens).toBe(12);
    expect(summary.unavailableUsageTurns).toBe(0);
    expect(summary.unavailableCostTurns).toBe(1);
  });
});
