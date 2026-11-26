export const APP_ENVIRONMENT = Symbol("APP_ENVIRONMENT");

export interface AppEnvironment {
  apiPort: number;
  databaseUrl: string;
  corsOrigins: string[];
  defaultExecutionBudgetUsd: number | null;
}

function parsePort(value: string | undefined): number {
  if (!value) return 3000;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid configuration: API_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

function parseDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("Invalid configuration: DATABASE_URL is required.");
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error();
    }
  } catch {
    throw new Error("Invalid configuration: DATABASE_URL must be a valid PostgreSQL URL.");
  }

  return value;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  return value.split(",").map((entry) => entry.trim()).filter(Boolean).map((origin) => {
    try {
      const parsed = new URL(origin);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.origin !== origin) {
        throw new Error();
      }
      return parsed.origin;
    } catch {
      throw new Error("Invalid configuration: CORS_ORIGINS must contain explicit HTTP or HTTPS origins.");
    }
  });
}

function parseDefaultBudget(value: string | undefined): number | null {
  if (!value?.trim()) return null;

  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Invalid configuration: EXECUTION_BUDGET_USD must be between 0.01 and 1000 with at most two decimals.");
  }

  const budget = Number(normalized);
  if (budget < 0.01 || budget > 1000) {
    throw new Error("Invalid configuration: EXECUTION_BUDGET_USD must be between 0.01 and 1000 with at most two decimals.");
  }
  return budget;
}

export function loadAppEnvironment(env: NodeJS.ProcessEnv = process.env): AppEnvironment {
  return {
    apiPort: parsePort(env.API_PORT),
    databaseUrl: parseDatabaseUrl(env.DATABASE_URL),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    defaultExecutionBudgetUsd: parseDefaultBudget(env.EXECUTION_BUDGET_USD),
  };
}
