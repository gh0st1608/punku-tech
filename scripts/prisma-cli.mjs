import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(repositoryRoot, "apps/orchestration-api/prisma/schema.prisma");
const prismaCliPath = resolve(repositoryRoot, "node_modules/prisma/build/index.js");

dotenv.config({ path: resolve(repositoryRoot, ".env") });

if (!existsSync(prismaCliPath)) {
  console.error("Prisma CLI was not found. Run npm install before using the database scripts.");
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, ...process.argv.slice(2), "--schema", schemaPath],
    { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
  );

  if (result.error) console.error(`Prisma command failed: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
}
