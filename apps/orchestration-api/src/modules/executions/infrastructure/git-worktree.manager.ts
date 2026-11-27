import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { AppEnvironment } from "../../../config/app-environment";

const executeFile = promisify(execFile);

export class GitWorktreeManager {
  constructor(private readonly environment: AppEnvironment) {}

  async create(executionId: string, branchName: string): Promise<string> {
    const directory = this.directoryFor(executionId);

    await mkdir(this.environment.opencodeWorktreeRoot, { recursive: true });
    await executeFile(
      "git",
      ["worktree", "add", "--no-track", "-b", branchName, directory, "HEAD"],
      {
        cwd: this.environment.opencodeWorkspaceRoot,
        windowsHide: true,
        timeout: 30_000,
      },
    );
    return directory;
  }

  directoryFor(executionId: string): string {
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
    return directory;
  }

  async validate(executionId: string): Promise<boolean> {
    const directory = this.directoryFor(executionId);
    try {
      const metadata = await stat(directory);
      if (!metadata.isDirectory()) return false;
      const result = await executeFile("git", ["rev-parse", "--show-toplevel"], {
        cwd: directory,
        windowsHide: true,
        timeout: 10_000,
      });
      const root = resolve(result.stdout.trim());
      return process.platform === "win32"
        ? root.toLowerCase() === directory.toLowerCase()
        : root === directory;
    } catch {
      return false;
    }
  }
}
