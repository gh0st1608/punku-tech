import type { PrismaService } from "../src/modules/prisma/prisma.service";
import { PrismaExecutionsRepository } from "../src/modules/executions/infrastructure/prisma-executions.repository";

const runnerId = "runner-1";
const executionId = "execution-1";

function createRepository(tx: object) {
  const prisma = {
    $transaction: jest.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)),
  } as unknown as PrismaService;
  return new PrismaExecutionsRepository(prisma);
}

describe("execution budget persistence", () => {
  it("records one warning event at 80 percent", async () => {
    const tx = {
      execution: {
        findUnique: jest.fn().mockResolvedValue({
          budgetUsd: 100,
          status: "RUNNING",
          runnerId,
        }),
      },
      event: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const repository = createRepository(tx);

    await expect(repository.enforceBudgetLimit(executionId, runnerId, 80)).resolves.toBe(
      "CONTINUE",
    );
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "EXECUTION_BUDGET_WARNING",
        payload: { budgetUsd: 100, spentUsd: 80, thresholdPercent: 80 },
      }),
    });
  });

  it("pauses task assignment at 100 percent and records the decision", async () => {
    const tx = {
      execution: {
        findUnique: jest.fn().mockResolvedValue({
          budgetUsd: 100,
          status: "RUNNING",
          runnerId,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      event: { create: jest.fn().mockResolvedValue({}) },
    };
    const repository = createRepository(tx);

    await expect(repository.enforceBudgetLimit(executionId, runnerId, 100)).resolves.toBe(
      "PAUSED",
    );
    expect(tx.execution.updateMany).toHaveBeenCalledWith({
      where: { id: executionId, status: "RUNNING", runnerId },
      data: { status: "PAUSED_BUDGET", runnerId: null, runnerLeaseUntil: null },
    });
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "EXECUTION_BUDGET_PAUSED",
        payload: { budgetUsd: 100, spentUsd: 100 },
      }),
    });
  });

  it("raises the limit and records human approval before resuming", async () => {
    const tx = {
      execution: {
        findUnique: jest.fn().mockResolvedValue({ budgetUsd: 100 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      event: { create: jest.fn().mockResolvedValue({}) },
    };
    const repository = createRepository(tx);

    await expect(repository.approveBudget(executionId, 150)).resolves.toBe(true);
    expect(tx.execution.updateMany).toHaveBeenCalledWith({
      where: { id: executionId, status: "PAUSED_BUDGET" },
      data: { status: "RUNNING", budgetUsd: 150 },
    });
    expect(tx.event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "EXECUTION_BUDGET_APPROVED",
        payload: { previousBudgetUsd: 100, approvedBudgetUsd: 150 },
      }),
    });
  });
});
