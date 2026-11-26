import { UsageRecordForSummary, UsageSummary } from "@aief/contracts";

const tokenFields = [
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
}

export function summarizeUsage(rows: UsageRecordForSummary[]): UsageSummary {
  const rowsWithTokens = rows.filter((row) => tokenFields.some((field) => row[field] !== null));
  const completeTokenRows = rows.filter((row) => row.inputTokens !== null && row.outputTokens !== null);
  const unavailableUsageTurns = rows.length - rowsWithTokens.length;

  let tokenAvailability: UsageSummary["tokenAvailability"] = "UNAVAILABLE";
  if (rowsWithTokens.length > 0) {
    tokenAvailability = completeTokenRows.length === rows.length ? "AVAILABLE" : "PARTIAL";
  }

  const reportedCostRows = rows.filter((row) => row.reportedCostUsd !== null);
  const estimatedCostRows = rows.filter((row) => row.estimatedCostUsd !== null);

  return {
    turns: rows.length,
    tokenAvailability,
    inputTokens: sumKnown(rows.map((row) => row.inputTokens)),
    outputTokens: sumKnown(rows.map((row) => row.outputTokens)),
    reasoningTokens: sumKnown(rows.map((row) => row.reasoningTokens)),
    cacheReadTokens: sumKnown(rows.map((row) => row.cacheReadTokens)),
    cacheWriteTokens: sumKnown(rows.map((row) => row.cacheWriteTokens)),
    unavailableUsageTurns,
    reportedCostUsd: sumKnown(rows.map((row) => row.reportedCostUsd)),
    reportedCostTurns: reportedCostRows.length,
    estimatedCostUsd: sumKnown(rows.map((row) => row.estimatedCostUsd)),
    estimatedCostTurns: estimatedCostRows.length,
    unavailableCostTurns: rows.filter((row) => row.reportedCostUsd === null && row.estimatedCostUsd === null).length,
  };
}
