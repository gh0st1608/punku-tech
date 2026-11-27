import type {
  CostDisplayStatus,
  UsageBreakdown,
  UsageRecordForSummary,
  UsageSummary,
} from "@aief/contracts";

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

function costStatus(rows: UsageRecordForSummary[]): CostDisplayStatus {
  const statuses = new Set(rows.map((row) => row.costStatus));
  if (statuses.size > 1) return "MIXED";
  return rows[0]?.costStatus ?? "UNAVAILABLE";
}

function breakdown(key: string, label: string, rows: UsageRecordForSummary[]): UsageBreakdown {
  return {
    key,
    label,
    turns: rows.length,
    inputTokens: sumKnown(rows.map((row) => row.inputTokens)),
    outputTokens: sumKnown(rows.map((row) => row.outputTokens)),
    reasoningTokens: sumKnown(rows.map((row) => row.reasoningTokens)),
    cacheReadTokens: sumKnown(rows.map((row) => row.cacheReadTokens)),
    cacheWriteTokens: sumKnown(rows.map((row) => row.cacheWriteTokens)),
    reportedCostUsd: sumKnown(rows.map((row) => row.reportedCostUsd)),
    estimatedCostUsd: sumKnown(rows.map((row) => row.estimatedCostUsd)),
    unavailableCostTurns: rows.filter((row) => row.costStatus === "UNAVAILABLE").length,
    costStatus: costStatus(rows),
    rateVersions: [...new Set(rows.flatMap((row) => (row.rateVersion ? [row.rateVersion] : [])))],
  };
}

function groupRows(
  rows: UsageRecordForSummary[],
  getGroup: (row: UsageRecordForSummary) => { key: string; label: string },
): UsageBreakdown[] {
  const groups = new Map<string, { label: string; rows: UsageRecordForSummary[] }>();
  for (const row of rows) {
    const group = getGroup(row);
    const current = groups.get(group.key) ?? { label: group.label, rows: [] };
    current.rows.push(row);
    groups.set(group.key, current);
  }
  return [...groups.entries()]
    .map(([key, group]) => breakdown(key, group.label, group.rows))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function summarizeUsage(rows: UsageRecordForSummary[]): UsageSummary {
  const rowsWithTokens = rows.filter((row) => tokenFields.some((field) => row[field] !== null));
  const completeTokenRows = rows.filter(
    (row) => row.inputTokens !== null && row.outputTokens !== null,
  );
  const reportedCostRows = rows.filter((row) => row.costStatus === "REPORTED");
  const estimatedCostRows = rows.filter((row) => row.costStatus === "ESTIMATED");

  let tokenAvailability: UsageSummary["tokenAvailability"] = "UNAVAILABLE";
  if (rowsWithTokens.length > 0) {
    tokenAvailability = completeTokenRows.length === rows.length ? "AVAILABLE" : "PARTIAL";
  }

  return {
    turns: rows.length,
    tokenAvailability,
    costStatus: costStatus(rows),
    inputTokens: sumKnown(rows.map((row) => row.inputTokens)),
    outputTokens: sumKnown(rows.map((row) => row.outputTokens)),
    reasoningTokens: sumKnown(rows.map((row) => row.reasoningTokens)),
    cacheReadTokens: sumKnown(rows.map((row) => row.cacheReadTokens)),
    cacheWriteTokens: sumKnown(rows.map((row) => row.cacheWriteTokens)),
    unavailableUsageTurns: rows.length - rowsWithTokens.length,
    reportedCostUsd: sumKnown(rows.map((row) => row.reportedCostUsd)),
    reportedCostTurns: reportedCostRows.length,
    estimatedCostUsd: sumKnown(rows.map((row) => row.estimatedCostUsd)),
    estimatedCostTurns: estimatedCostRows.length,
    unavailableCostTurns: rows.filter((row) => row.costStatus === "UNAVAILABLE").length,
    byAgent: groupRows(rows, (row) => ({
      key: row.agentId ?? "unknown-agent",
      label: row.agentId ?? "Agente desconocido",
    })),
    byTask: groupRows(rows, (row) => ({
      key: row.taskId ?? "unknown-task",
      label: row.taskId ? `Tarea ${row.taskId.slice(0, 8)}` : "Tarea desconocida",
    })),
    byModel: groupRows(rows, (row) => {
      const provider = row.provider ?? "unknown-provider";
      const model = row.model ?? "unknown-model";
      return {
        key: `${provider}/${model}`,
        label: `${row.provider ?? "Proveedor desconocido"} / ${row.model ?? "Modelo desconocido"}`,
      };
    }),
  };
}
