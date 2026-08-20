import * as fs from "fs/promises";
import * as path from "path";

export type PathValidation =
  | { ok: true; relative: string; absolute: string }
  | { ok: false; reason: string };

export function normalizeConfigPath(raw: string): string {
  return raw.replace(/\\/g, "/").trim();
}

export function validateGitRootRelativePath(
  raw: string,
  gitRoot: string,
): PathValidation {
  const _normalized = normalizeConfigPath(raw);
  if (!_normalized) {
    return { ok: false, reason: "empty path" };
  }
  if (_normalized.includes("~") || _normalized.startsWith("~")) {
    return { ok: false, reason: "tilde is not allowed" };
  }
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(_normalized) || /%[A-Za-z_][A-Za-z0-9_]*%/.test(_normalized)) {
    return { ok: false, reason: "environment variables are not allowed" };
  }
  if (path.posix.isAbsolute(_normalized) || path.win32.isAbsolute(_normalized)) {
    return { ok: false, reason: "absolute paths are not allowed" };
  }
  const _segments = _normalized.split("/").filter((s) => s.length > 0);
  if (_segments.some((s) => s === "..")) {
    return { ok: false, reason: ".. segments are not allowed" };
  }
  const _absolute = path.resolve(gitRoot, ..._segments);
  const _rel = path.relative(gitRoot, _absolute);
  if (_rel.startsWith("..") || path.isAbsolute(_rel)) {
    return { ok: false, reason: "path resolves outside the git root" };
  }
  const _relative = _segments.join("/");
  return { ok: true, relative: _relative, absolute: _absolute };
}

export async function isDirectory(absolutePath: string): Promise<boolean> {
  try {
    const _stat = await fs.stat(absolutePath);
    return _stat.isDirectory();
  } catch {
    return false;
  }
}

export async function isRegularFile(absolutePath: string): Promise<boolean> {
  try {
    const _stat = await fs.stat(absolutePath);
    return _stat.isFile();
  } catch {
    return false;
  }
}

export async function unlinkIfRegularFile(absolutePath: string): Promise<boolean> {
  if (!(await isRegularFile(absolutePath))) {
    return false;
  }
  await fs.unlink(absolutePath);
  return true;
}
