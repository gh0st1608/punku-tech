import { evaluateBudget } from "../src/modules/executions/application/budget-policy";

describe("execution budget policy", () => {
  it("does not alert below the 80 percent threshold", () => {
    expect(evaluateBudget(100, 79.99)).toBe("CONTINUE");
  });

  it("alerts from 80 percent until the full limit", () => {
    expect(evaluateBudget(100, 80)).toBe("WARN");
    expect(evaluateBudget(100, 99.99)).toBe("WARN");
  });

  it("pauses at and above the configured limit", () => {
    expect(evaluateBudget(100, 100)).toBe("PAUSE");
    expect(evaluateBudget(100, 125)).toBe("PAUSE");
  });

  it("keeps the runner active when no positive budget is configured", () => {
    expect(evaluateBudget(null, 100)).toBe("CONTINUE");
    expect(evaluateBudget(0, 100)).toBe("CONTINUE");
  });
});
