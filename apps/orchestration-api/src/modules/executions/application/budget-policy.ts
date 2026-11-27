export type BudgetDecision = "CONTINUE" | "WARN" | "PAUSE";

export function evaluateBudget(budgetUsd: number | null, spentUsd: number): BudgetDecision {
  if (budgetUsd === null || budgetUsd <= 0 || spentUsd < budgetUsd * 0.8) return "CONTINUE";
  if (spentUsd >= budgetUsd) return "PAUSE";
  return "WARN";
}
