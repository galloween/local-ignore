import * as fs from "fs/promises";
import * as path from "path";

export const BLOCK_START = "# >>> local-ignore (managed)";
export const BLOCK_END = "# <<< local-ignore";

export async function upsertManagedExclude(
  excludeFile: string,
  relativePaths: string[],
): Promise<void> {
  await fs.mkdir(path.dirname(excludeFile), { recursive: true });
  let _existing = "";
  try {
    _existing = await fs.readFile(excludeFile, "utf8");
  } catch {
    _existing = "";
  }
  const _rewritten = rewriteExclude(_existing, relativePaths);
  if (_rewritten !== _existing) {
    await fs.writeFile(excludeFile, _rewritten, "utf8");
  }
}

export function rewriteExclude(content: string, relativePaths: string[]): string {
  const _normalizedEol = content.replace(/\r\n/g, "\n");
  const _hadTrailingNewline = _normalizedEol.endsWith("\n") || _normalizedEol.length === 0;
  const _lines = _normalizedEol.split("\n");
  if (_lines.length > 0 && _lines[_lines.length - 1] === "") {
    _lines.pop();
  }

  const _start = _lines.indexOf(BLOCK_START);
  const _end = _lines.indexOf(BLOCK_END);
  const _outside: string[] = [];
  if (_start === -1) {
    _outside.push(..._lines);
  } else if (_end === -1 || _end < _start) {
    _outside.push(..._lines.slice(0, _start), ..._lines.slice(_start + 1));
  } else {
    _outside.push(..._lines.slice(0, _start), ..._lines.slice(_end + 1));
  }

  const _outsideSet = new Set(
    _outside
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const _seen = new Set<string>();
  const _managed: string[] = [];
  for (const _p of relativePaths) {
    if (_seen.has(_p) || _outsideSet.has(_p)) {
      continue;
    }
    _seen.add(_p);
    _managed.push(_p);
  }

  const _result = [..._outside.filter((line, i, arr) => !(line === "" && i === arr.length - 1))];
  while (_result.length > 0 && _result[_result.length - 1] === "") {
    _result.pop();
  }
  if (_result.length > 0) {
    _result.push("");
  }
  _result.push(BLOCK_START, ..._managed, BLOCK_END);
  const _joined = _result.join("\n");
  return _hadTrailingNewline ? `${_joined}\n` : _joined;
}

export function removePathFromManagedBlock(content: string, relativePath: string): string {
  const _normalizedEol = content.replace(/\r\n/g, "\n");
  const _lines = _normalizedEol.split("\n");
  const _start = _lines.indexOf(BLOCK_START);
  const _end = _lines.indexOf(BLOCK_END);
  if (_start === -1 || _end === -1 || _end < _start) {
    return content;
  }
  const _next = [
    ..._lines.slice(0, _start + 1),
    ..._lines.slice(_start + 1, _end).filter((line) => line.trim() !== relativePath),
    ..._lines.slice(_end),
  ];
  return _next.join("\n");
}

export async function removeManagedPath(
  excludeFile: string,
  relativePath: string,
): Promise<void> {
  let _existing = "";
  try {
    _existing = await fs.readFile(excludeFile, "utf8");
  } catch {
    return;
  }
  const _next = removePathFromManagedBlock(_existing, relativePath);
  if (_next !== _existing) {
    await fs.writeFile(excludeFile, _next, "utf8");
  }
}
