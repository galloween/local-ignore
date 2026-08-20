import { spawn } from "child_process";
import * as path from "path";
import * as vscode from "vscode";

export type GitResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export class GitCommandError extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult,
  ) {
    super(
      `git ${args.join(" ")} exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
    this.name = "GitCommandError";
  }
}

export function getGitExecutable(): string {
  const _configured = vscode.workspace.getConfiguration("git").get<string>("path");
  if (_configured && _configured.trim()) {
    return _configured.trim();
  }
  return "git";
}

export function runGit(
  gitPath: string,
  cwd: string,
  args: string[],
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const _child = spawn(gitPath, args, { cwd, windowsHide: true });
    let _stdout = "";
    let _stderr = "";
    _child.stdout.on("data", (chunk: Buffer | string) => {
      _stdout += chunk.toString();
    });
    _child.stderr.on("data", (chunk: Buffer | string) => {
      _stderr += chunk.toString();
    });
    _child.on("error", reject);
    _child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: _stdout,
        stderr: _stderr,
      });
    });
  });
}

export async function runGitOk(
  gitPath: string,
  cwd: string,
  args: string[],
): Promise<GitResult> {
  const _result = await runGit(gitPath, cwd, args);
  if (_result.code !== 0) {
    throw new GitCommandError(args, _result);
  }
  return _result;
}

export async function getRepoRoot(
  gitPath: string,
  folderPath: string,
): Promise<string | undefined> {
  const _result = await runGit(gitPath, folderPath, ["rev-parse", "--show-toplevel"]);
  if (_result.code !== 0) {
    return undefined;
  }
  const _root = _result.stdout.trim();
  return _root || undefined;
}

export async function getExcludePath(gitPath: string, gitRoot: string): Promise<string> {
  const _result = await runGitOk(gitPath, gitRoot, ["rev-parse", "--git-path", "info/exclude"]);
  const _raw = _result.stdout.trim();
  return path.isAbsolute(_raw) ? _raw : path.resolve(gitRoot, _raw);
}

export async function isTracked(
  gitPath: string,
  gitRoot: string,
  relativePath: string,
): Promise<boolean> {
  const _result = await runGit(gitPath, gitRoot, [
    "ls-files",
    "--error-unmatch",
    "--",
    relativePath,
  ]);
  return _result.code === 0;
}

export async function skipWorktree(
  gitPath: string,
  gitRoot: string,
  relativePath: string,
): Promise<GitResult> {
  return runGit(gitPath, gitRoot, ["update-index", "--skip-worktree", "--", relativePath]);
}

export async function noSkipWorktree(
  gitPath: string,
  gitRoot: string,
  relativePath: string,
): Promise<GitResult> {
  return runGit(gitPath, gitRoot, ["update-index", "--no-skip-worktree", "--", relativePath]);
}

export async function checkoutPath(
  gitPath: string,
  gitRoot: string,
  relativePath: string,
): Promise<GitResult> {
  return runGit(gitPath, gitRoot, ["checkout", "--", relativePath]);
}

export async function hasSkipWorktree(
  gitPath: string,
  gitRoot: string,
  relativePath: string,
): Promise<boolean> {
  const _result = await runGit(gitPath, gitRoot, ["ls-files", "-v", "--", relativePath]);
  if (_result.code !== 0) {
    return false;
  }
  const _line = _result.stdout.trim().split("\n")[0] ?? "";
  return _line.startsWith("S");
}

export async function isHeadBehindUpstream(
  gitPath: string,
  gitRoot: string,
): Promise<boolean> {
  const _count = await runGit(gitPath, gitRoot, ["rev-list", "--count", "HEAD..@{upstream}"]);
  if (_count.code !== 0) {
    return false;
  }
  const _n = Number.parseInt(_count.stdout.trim(), 10);
  return Number.isFinite(_n) && _n > 0;
}

export async function incomingNames(
  gitPath: string,
  gitRoot: string,
): Promise<string[]> {
  const _result = await runGit(gitPath, gitRoot, [
    "diff",
    "--name-only",
    "HEAD...@{upstream}",
  ]);
  if (_result.code !== 0) {
    return [];
  }
  return _result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
