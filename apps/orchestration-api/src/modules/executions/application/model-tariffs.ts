export interface ModelTariff {
  provider: string;
  model: string;
  version: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  reasoningUsdPerMillionTokens: number;
  cacheReadUsdPerMillionTokens: number;
  cacheWriteUsdPerMillionTokens: number;
}

export interface UsageTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseTariff(candidate: unknown): ModelTariff {
  if (!isRecord(candidate))
    throw new Error("Invalid configuration: MODEL_TARIFFS_JSON is invalid.");

  const { provider, model, version } = candidate;
  const inputUsdPerMillionTokens = candidate.inputUsdPerMillionTokens;
  const outputUsdPerMillionTokens = candidate.outputUsdPerMillionTokens;
  const reasoningUsdPerMillionTokens = candidate.reasoningUsdPerMillionTokens;
  const cacheReadUsdPerMillionTokens = candidate.cacheReadUsdPerMillionTokens;
  const cacheWriteUsdPerMillionTokens = candidate.cacheWriteUsdPerMillionTokens;
  if (
    !requiredText(provider) ||
    !requiredText(model) ||
    !requiredText(version) ||
    !validRate(inputUsdPerMillionTokens) ||
    !validRate(outputUsdPerMillionTokens) ||
    !validRate(reasoningUsdPerMillionTokens) ||
    !validRate(cacheReadUsdPerMillionTokens) ||
    !validRate(cacheWriteUsdPerMillionTokens)
  ) {
    throw new Error("Invalid configuration: MODEL_TARIFFS_JSON is invalid.");
  }

  return {
    provider: provider.trim(),
    model: model.trim(),
    version: version.trim(),
    inputUsdPerMillionTokens,
    outputUsdPerMillionTokens,
    reasoningUsdPerMillionTokens,
    cacheReadUsdPerMillionTokens,
    cacheWriteUsdPerMillionTokens,
  };
}

export function parseModelTariffs(value: string | undefined): ModelTariff[] {
  if (!value?.trim()) return [];

  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("Invalid configuration: MODEL_TARIFFS_JSON must contain a JSON array.");
  }
  if (!Array.isArray(decoded)) {
    throw new Error("Invalid configuration: MODEL_TARIFFS_JSON must contain a JSON array.");
  }

  const tariffs = decoded.map(parseTariff);
  const keys = tariffs.map(({ provider, model, version }) => `${provider}\0${model}\0${version}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Invalid configuration: MODEL_TARIFFS_JSON contains duplicate versions.");
  }
  return tariffs;
}

export function findModelTariff(
  tariffs: ModelTariff[],
  provider: string | null,
  model: string | null,
): ModelTariff | null {
  if (!provider || !model) return null;
  return tariffs.find((tariff) => tariff.provider === provider && tariff.model === model) ?? null;
}

export function estimateUsageCost(tariff: ModelTariff, tokens: UsageTokens): number | null {
  const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens } = tokens;
  if (
    inputTokens === null ||
    outputTokens === null ||
    reasoningTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null
  )
    return null;

  const cost =
    (inputTokens * tariff.inputUsdPerMillionTokens +
      outputTokens * tariff.outputUsdPerMillionTokens +
      reasoningTokens * tariff.reasoningUsdPerMillionTokens +
      cacheReadTokens * tariff.cacheReadUsdPerMillionTokens +
      cacheWriteTokens * tariff.cacheWriteUsdPerMillionTokens) /
    1_000_000;
  return Number(cost.toFixed(8));
}
