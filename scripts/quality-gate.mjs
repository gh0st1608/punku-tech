import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactDirectory = resolve(root, "artifacts/qa");
const logDirectory = join(artifactDirectory, "logs");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [];

function gitValue(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

await mkdir(logDirectory, { recursive: true });

function redact(output) {
  return output
    .replace(
      /((?:authorization|password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]");
}

async function runCheck(key, label, command, args, { env = {} } = {}) {
  const logName = `${key}.log`;
  const logFile = join(logDirectory, logName);
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env, CI: process.env.CI || "true" },
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
    timeout: 15 * 60 * 1000,
  });
  const output = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  await writeFile(logFile, output || "(sin salida)\n", "utf8");
  process.stdout.write(`\n[${key}] ${label}\n`);
  if (output) process.stdout.write(output);
  const status = result.error || result.status !== 0 ? "FAIL" : "PASS";
  const check = {
    key,
    label,
    status,
    command: [command, ...args].join(" "),
    startedAt,
    durationMs: Date.now() - start,
    exitCode: result.status ?? null,
    evidence: relative(root, logFile).replaceAll("\\", "/"),
    ...(result.error ? { error: redact(result.error.message) } : {}),
  };
  checks.push(check);
  return check;
}

async function trackedSecretCheck() {
  const command = "git";
  const args = ["ls-files", "-co", "--exclude-standard", "-z"];
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const files = (result.stdout ?? "").split("\0").filter(Boolean);
  const envFiles = files.filter((file) => /(^|[\\/])\.env(?:\.[^\\/]+)?$/.test(file));
  const unexpectedEnvFiles = envFiles.filter((file) => !/(^|[\\/])\.env\.example$/.test(file));
  const highConfidenceSecret =
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16})\b/;
  const secretMatches = [];
  for (const file of files) {
    if (/node_modules|package-lock\.json|artifacts[\\/]qa/i.test(file)) continue;
    let contents;
    try {
      contents = await readFile(resolve(root, file), "utf8");
    } catch {
      continue;
    }
    if (highConfidenceSecret.test(contents)) secretMatches.push(file);
  }
  const findings = [...unexpectedEnvFiles, ...secretMatches];
  const status = result.error || result.status !== 0 || findings.length > 0 ? "FAIL" : "PASS";
  const logFile = join(logDirectory, "security-tracked-files.log");
  const evidenceText = findings.length
    ? `Archivos que requieren revisión: ${findings.join(", ")}\n`
    : "No hay archivos .env reales ni patrones de credenciales de alta confianza entre los archivos rastreados.\n";
  await writeFile(logFile, evidenceText, "utf8");
  const check = {
    key: "security-tracked-files",
    label: "Archivos rastreados y secretos",
    status,
    command: "git ls-files -co --exclude-standard + scan de patrones de alta confianza",
    startedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: status === "PASS" ? 0 : 1,
    evidence: relative(root, logFile).replaceAll("\\", "/"),
  };
  checks.push(check);
  process.stdout.write(`\n[${check.key}] ${check.label}: ${status}\n${evidenceText}`);
  return check;
}

async function executionContext() {
  const executionId = process.env.AIEF_EXECUTION_ID?.trim();
  if (!executionId) {
    return {
      status: "NOT_RUN",
      executionId: null,
      reason:
        "Configura AIEF_EXECUTION_ID y AIEF_API_BASE_URL para incluir datos de una ejecución.",
      cost: {
        status: "NOT_RUN",
        reportedCostUsd: null,
        estimatedCostUsd: null,
        unavailableCostTurns: null,
      },
      deliverables: { status: "NOT_RUN", items: [] },
    };
  }

  const apiBaseUrl = (process.env.AIEF_API_BASE_URL || "http://127.0.0.1:3000/api").replace(
    /\/$/,
    "",
  );
  try {
    const [detailsResponse, usageResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/executions/${encodeURIComponent(executionId)}`, {
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`${apiBaseUrl}/executions/${encodeURIComponent(executionId)}/usage`, {
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!detailsResponse.ok || !usageResponse.ok) {
      throw new Error(`API respondió ${detailsResponse.status}/${usageResponse.status}`);
    }
    const [details, usage] = await Promise.all([detailsResponse.json(), usageResponse.json()]);
    const items = (details.tasks ?? []).flatMap((task) =>
      (task.artifactPaths ?? []).map((path) => ({ taskId: task.id, taskTitle: task.title, path })),
    );
    return {
      status: "PASS",
      executionId,
      cost: {
        status: usage.costStatus ?? "UNAVAILABLE",
        reportedCostUsd: usage.reportedCostUsd,
        estimatedCostUsd: usage.estimatedCostUsd,
        unavailableCostTurns: usage.unavailableCostTurns,
      },
      deliverables: { status: "PASS", items },
    };
  } catch (error) {
    const reason =
      error instanceof Error ? redact(error.message) : "No se pudo consultar la ejecución.";
    return {
      status: "FAIL",
      executionId,
      reason,
      cost: {
        status: "NOT_RUN",
        reportedCostUsd: null,
        estimatedCostUsd: null,
        unavailableCostTurns: null,
      },
      deliverables: { status: "NOT_RUN", items: [] },
    };
  }
}

await runCheck("format", "Formato", npmExecutable, ["run", "format:check"]);
await runCheck("lint", "ESLint", npmExecutable, ["run", "lint"]);
await runCheck("typecheck", "TypeScript", npmExecutable, ["run", "typecheck"]);
await runCheck("build", "Build de workspaces", npmExecutable, ["run", "build"]);
await runCheck("api-tests", "Jest y Supertest", npmExecutable, ["run", "test:api"]);
await runCheck("e2e-tests", "Playwright E2E", npmExecutable, ["run", "test:e2e"]);
await trackedSecretCheck();
await runCheck(
  "security-dependencies",
  "Auditoría de dependencias instaladas en producción",
  npmExecutable,
  ["audit", "--omit=dev", "--omit=optional", "--audit-level=high"],
);

const context = await executionContext();
const contextCheck = process.env.AIEF_EXECUTION_ID?.trim()
  ? {
      key: "execution-context",
      label: "Costo y entregables de ejecución",
      status: context.status,
      command: "GET /executions/:id y /usage",
      startedAt: new Date().toISOString(),
      durationMs: null,
      exitCode: context.status === "PASS" ? 0 : 1,
      evidence: "quality-gate-summary.json",
    }
  : null;
if (contextCheck) checks.push(contextCheck);

const coreChecks = checks.filter((check) => check.key !== "execution-context");
const overallStatus =
  coreChecks.some((check) => check.status === "FAIL") || context.status === "FAIL"
    ? "FAIL"
    : coreChecks.some((check) => check.status === "NOT_RUN")
      ? "NOT_RUN"
      : "PASS";
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: overallStatus,
  branch: process.env.GITHUB_REF_NAME ?? gitValue(["branch", "--show-current"]),
  commit: process.env.GITHUB_SHA ?? gitValue(["rev-parse", "HEAD"]),
  checks,
  execution: context,
};

await writeFile(
  join(artifactDirectory, "quality-gate-summary.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
const checkRows = checks
  .map((check) => `| ${check.label} | ${check.status} | \`${check.evidence}\` |`)
  .join("\n");
const deliverableRows = context.deliverables.items.length
  ? context.deliverables.items.map((item) => `| ${item.taskTitle} | \`${item.path}\` |`).join("\n")
  : "| — | Sin entregables registrados en esta ejecución. |";
const markdown = [
  "# Quality Gate",
  "",
  `- Estado: **${overallStatus}**`,
  `- Generado: ${report.generatedAt}`,
  `- Commit: ${report.commit ?? "no disponible"}`,
  "",
  "## Verificaciones",
  "",
  "| Verificación | Estado | Evidencia |",
  "| --- | --- | --- |",
  checkRows,
  "",
  "## Ejecución, costo y entregables",
  "",
  `- Estado de contexto: **${context.status}**`,
  `- ID de ejecución: ${context.executionId ?? "no proporcionado"}`,
  `- Costo reportado: ${context.cost.reportedCostUsd ?? "NOT_RUN"} USD`,
  `- Costo estimado: ${context.cost.estimatedCostUsd ?? "NOT_RUN"} USD`,
  `- Turnos sin costo disponible: ${context.cost.unavailableCostTurns ?? "NOT_RUN"}`,
  "",
  "| Tarea | Entregable |",
  "| --- | --- |",
  deliverableRows,
  "",
  "Los logs y reportes de Jest/Supertest y Playwright se adjuntan como artefactos del workflow.",
  "",
].join("\n");
await writeFile(join(artifactDirectory, "quality-gate-summary.md"), markdown);
process.stdout.write(
  `\nQuality Gate: ${overallStatus}\nResumen: ${basename(join(artifactDirectory, "quality-gate-summary.md"))}\n`,
);
if (overallStatus !== "PASS") process.exitCode = 1;
