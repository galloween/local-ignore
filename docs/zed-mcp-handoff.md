# Handoff: Zed Local Ignore via stdio MCP

**Next session:** implement a long-lived stdio MCP that does what the VS Code/Cursor extension does on disk, with apply/restore/unstick as MCP tools (agent command surface, not a Command Palette).

This is not a Zed WASM extension. Product spec stays in `AGENTS.md`. User-facing Git recipes stay in `README.md`. Agent CLI recipes stay in `skills/local-ignore/SKILL.md`. Do not copy those here; implement against them.

VS Code source of truth: `src/extension.ts` (`applyLocalIgnore`), `src/git.ts`, `src/exclude.ts`, `src/paths.ts`. Current marketplace version at time of writing: `0.1.1`.

---

## Goal

Same Git effects as Local Ignore:

1. Upsert configured paths into the managed `.git/info/exclude` block.
2. `git update-index --skip-worktree -- <path>` (non-zero is fine; never `git add`).
3. Optional unlink if `delete` is true, with the tracked + failed-skip-worktree guard.

Triggers to port:

| VS Code | Zed MCP equivalent |
| --- | --- |
| `onStartupFinished` / activate apply | Apply once after MCP `initialize` |
| File watcher on configured paths | `fs.watch` / chokidar in the same process |
| Git extension `state.onDidChange` (debounced 300ms) | Poll `.git` or `HEAD` / index mtime; same debounce |
| Commands Apply / Restore / Unstick | MCP tools with the same names |
| `localIgnore.autoRetryScmPull` → `git.pull` | **Skip.** There is no Zed command to retry SCM pull. Auto-unstick only; log “unstuck, pull again”. |

Config for v1 of this MCP: **argv** (and optional env), not VS Code settings. Zed has no `localIgnore.files` key.

---

## Why not a real Zed extension

Zed extensions are WASM (`zed_extension_api`). They do not get VS Code–style `onStartupFinished`, workspace file watchers, or a license to spawn Git as a background daemon. Slash commands and language-server/MCP *registration* exist; a always-on Git mutator does not.

Do not ship a fake LSP or fake DAP. LSP starts when a matching buffer opens. DAP starts when you debug. Neither is “folder open.”

`tasks.json` only has a `create_worktree` hook plus manual spawn. Formatters run on format. Git Graph custom commands are click-to-run. None of those is a daemon.

**The only Zed setting that starts a long-lived process on project open is `context_servers` (MCP).** That is the host. Treat it as an opt-in “dev extension”: people paste config; no marketplace required.

---

## Why not Git hooks

Confirmed on a large monorepo, including a live experiment (not just reading config):

- Repos that use Husky (or similar) set **local** `core.hooksPath`. Git uses one hooks directory. Local config always beats global (`system → global → local → worktree`).
- The same `.git/config` can later `[include]` another tool that sets `core.hooksPath` again. Last writer in that file wins. `git rev-parse --git-path hooks` is the source of truth, not the first `hooksPath` line.
- **Global hooks do not fire there.** Pointing `~/.gitconfig` `core.hooksPath` at test `post-checkout` / `post-merge` / `post-commit` scripts, then running real commits, checkouts, and merges: no scripts ran. The same fake global config **did** fire in a brand-new vanilla repo with no local `hooksPath`. The mechanism works; a local override kills it.
- Editors and extra Git helpers may wrap every hook name in their own binary. **`pre-commit` can still reach Husky** (lint-staged still ran on a real commit) if the wrapper chains. That is the wrapper’s behavior, not Git’s contract.
- This monorepo had **no** Husky `post-checkout` / `post-merge` / `post-commit`. For those events the wrapper is the only thing Git will invoke, and it will not consult `~/.gitconfig`. A working `pre-commit` chain does not give you apply-on-pull/checkout.
- Do not “fix” this by setting `git config core.hooksPath` in the clone (breaks Husky and whatever else owns that socket). Do not add Local Ignore as a Husky hook. Do not set `core.hooksPath` or `--no-verify` from this project. Exclude + skip-worktree from our process only.

---

## Recipe: stdio MCP (implement this)

### Process contract

- Speak MCP over stdin/stdout (JSON-RPC). Stay alive after `initialize` / `notifications/initialized`.
- **If the process applies and exits, Zed treats it as a crash and may restart it in a loop.** The apply loop belongs *inside* the living server.
- Log to stderr (or a file). stdout is the protocol.
- `cwd` should be the project root (Zed starts context servers per project). Still resolve Git root with `git rev-parse --show-toplevel` (linked worktrees).
- Honor `GIT_EXECUTABLE` env or argv `--git`; do not import `vscode` (`src/git.ts` today reads `git.path` from VS Code config — inject the binary instead).
- Absolute path for `command` in Zed settings. GUI Zed PATH is unreliable; `npx` is a trap ([zed#60800](https://github.com/zed-industries/zed/issues/60800)).

### When Zed actually starts it

Starts for **a trusted project**, not empty-window app launch.

Will **not** run if:

- worktree is untrusted (Restricted Mode)
- `disable_ai` / AI off (Zed stops all context servers)
- the server is disabled in MCP UI
- the folder is never opened in Zed

Document that. Terminal `git` without Zed is still the agent skill / manual recipes.

### Zed settings (project `.zed/settings.json` or pasted user snippet)

Do **not** put machine-local ignore lists in a committed team `.zed/settings.json` (same warning as committing `.vscode/settings.json`).

```json
{
  "context_servers": {
    "local-ignore": {
      "command": "/usr/bin/node",
      "args": [
        "/ABSOLUTE/PATH/TO/local-ignore-mcp.mjs",
        "--file", ".cursor/mcp.json",
        "--delete",
        "--file", "some/other.json"
      ],
      "env": {}
    }
  }
}
```

Schema notes (Zed docs, `context_servers`):

- Local servers: `command`, `args`, `env`.
- Some docs also show `"source": "custom"`; match whatever the installed Zed version writes from **Settings → AI → MCP Servers**.
- `args` is a string array. One JSON blob as a single arg works but is painful to edit. Prefer repeated `--file <path>` with `--delete` applying to the preceding file (or `--file path:delete`).

User-global `context_servers` with those paths would run the same relative paths in every repo. **Per-project config.**

### Argv config (v1)

Parse into the same shape as `LocalIgnoreFile` in `src/extension.ts`: `{ path, delete?: boolean }`.

Suggested flags:

- `--file <git-root-relative>` (repeatable)
- `--delete` (applies to the last `--file`)
- `--enable` / `--no-enable` (default on)
- `--auto-unstick` / `--no-auto-unstick` (default on)
- `--git <path>` optional

Validate with `validateGitRootRelativePath` rules from `AGENTS.md` / `src/paths.ts` (no `..`, no absolute, files only, no directories).

### MCP tools (the “commands”)

Expose at least:

| Tool | Maps to |
| --- | --- |
| `local_ignore_apply` | `localIgnore.apply` |
| `local_ignore_restore` | `localIgnore.restore` — required arg `path` |
| `local_ignore_unstick` | `localIgnore.unstick` |

Keep names stable and boring so agents can call them without a second skill. Tool descriptions should state: never `git add`, never `git rm` / `rm --cached`, never delete directories.

Optional later: `local_ignore_status` (exclude block + skip-worktree bits) for debugging.

Zed may prompt for tool approval unless `agent.always_allow_tool_actions` is true. Background apply on initialize does not need a tool call.

### Background behavior (inside the living process)

After initialize:

1. Apply once (if enabled and file list non-empty).
2. Watch each configured relative path; debounce `DEBOUNCE_MS` 300; apply.
3. If `autoUnstick`: on git-state change, same rules as `AGENTS.md` (HEAD behind upstream **and** incoming names intersect configured paths **and** skip-worktree still set → unstick those paths only; do not unstick on unrelated fetch). Then apply again. **Do not** `git pull`.
4. Re-create watchers if args cannot change at runtime (they cannot without restart). Zed restart of the server is OK.

### Code reuse

Prefer extracting vscode-free modules rather than duplicating Git/exclude logic:

- `src/exclude.ts` — already vscode-free.
- `src/paths.ts` — already vscode-free.
- `src/git.ts` — drop `getGitExecutable`’s vscode config; pass `gitPath` in.
- Lift `applyLocalIgnore` / restore / unstick out of `src/extension.ts` into something like `src/apply.ts` that takes `gitPath`, `cwd`, `files`, `logger`. Keep the VS Code extension as a thin host. The MCP is another thin host.

TypeScript strict. ESM or CJS: match the repo (`commonjs` in `tsconfig.json` today). No `require()`.

Minimal MCP surface: `@modelcontextprotocol/sdk` **or** a tiny handshake without a fat SDK if you want zero runtime deps in the VS Code VSIX. Do not add MCP deps to the published VS Code extension if they would ship in the VSIX. Separate `package.json` under e.g. `zed-mcp/` is cleaner.

### Non-goals (this slice)

- WASM Zed extension
- Open VSX / Zed extension marketplace
- Fake LSP / DAP
- Global or repo Git hooks
- Auto `git pull` from the MCP
- Glob paths / directories (still v1 limits in `AGENTS.md`)

---

## Suggested skills (next agent)

1. **`local-ignore`** (`skills/local-ignore/SKILL.md` in this repo, or `~/.agents/skills/local-ignore`) — Git safety rules while implementing and testing.
2. Repo **`AGENTS.md`** — treat as the implementer spec; MCP must not violate Safety / Git invocation.
3. **`refactor-discipline`** if splitting `applyLocalIgnore` out of `src/extension.ts` so the VS Code host stays thin.
4. **`unit-test-writer` / `unit-test-runner`** for argv parsing, exclude block rewrite, and apply guards (no `git add`). This repo may not have tests yet; add a small Node test runner. Do not assume another workspace’s test command.
5. After implementation, **`code-review-self`** then ship only if the user asks for commit/PR (`pr-open` / review-and-ship). Do not commit unless asked.

---

## Done when

- A Node (or similar) stdio server applies exclude + skip-worktree on MCP initialize using argv file list.
- Process stays up; Zed MCP indicator is healthy.
- Tools apply / restore / unstick work via the agent.
- File recreation at a configured path is hidden/deleted again while the server lives.
- Auto-unstick without auto-pull when incoming commits touch configured paths.
- VS Code extension still matches `AGENTS.md` (refactor host only if extracted).
- README gets a short “Zed (experimental MCP)” section **only if the user wants user-facing docs**; this handoff is implementer-only until then.
