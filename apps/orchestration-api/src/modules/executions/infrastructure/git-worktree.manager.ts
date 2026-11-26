import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { AppEnvironment } from "../../../config/app-environment";

const executeFile = promisify(execFile);

export class GitWorktreeManager {
  constructor(private readonly environment: AppEnvironment) {}

  async create(executionId: string): Promise<string> {
    const directory = resolve(this.environment.opencodeWorktreeRoot, executionId);
    const pathFromRoot = relative(this.environment.opencodeWorktreeRoot, directory);
    if (
      !pathFromRoot ||
      pathFromRoot === ".." ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error("Invalid execution workspace path.");
    }

    await mkdir(this.environment.opencodeWorktreeRoot, { recursive: true });
    await executeFile("git", ["worktree", "add", "--detach", directory, "HEAD"], {
      cwd: this.environment.opencodeWorkspaceRoot,
      windowsHide: true,
      timeout: 30_000,
    });
    return directory;
  }
}
