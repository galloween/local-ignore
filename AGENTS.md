# Local Ignore

VS Code / Cursor extension (`local-ignore`, publisher `galloween`). On folder open, hide configured paths from `git status` / commits by **always** doing both:

1. Upsert the path in `.git/info/exclude` (no-op for tracked files today; kicks in if they become untracked).
2. `git update-index --skip-worktree -- <path>` (no-op / non-zero if the path is not in the index — log and continue; **never** `git add` to make skip-worktree apply).

Then optional unlink if `delete` is true.

No tracked/untracked branching in the happy path. Git ignores whichever lever does not apply.

This file is the implementer spec. `README.md` is the marketplace listing. Keep README user-facing; do not paste this spec into it. Do not paste user-facing marketing into this file.

## Product rules

- Config key: `localIgnore.files`.
- Each entry is an object: `{ "path": "<git-root-relative>", "delete": true | false }`.
- `path` is relative to the **Git repository root** of that workspace folder (not the VS Code folder if they differ). Use `/` separators in settings; normalize on Windows.
- `delete` defaults to `false`: hide via exclude + skip-worktree attempt; leave the file on disk. `true`: do those two, then unlink if the path exists and is a regular file.
- Every apply, for **every** configured path, in order:
  1. Upsert into the managed `exclude` block (all config paths, not a tracked subset).
  2. `git update-index --skip-worktree -- <path>`. Non-zero is normal when the path is not in the index. Log it. Do not throw. **Never `git add` / `update-index --add`.**
  3. If `delete`, unlink the file. If the path is tracked (`git ls-files --error-unmatch` succeeds) **and** step 2 failed, skip unlink (index may be locked; do not leave a tracked `D` without skip-worktree). Untracked delete does not wait on skip-worktree.
- Resolve exclude file with `git rev-parse --git-path info/exclude`. On linked worktrees this is usually the **shared** exclude under the main `.git` (all worktrees of that clone). skip-worktree remains **per worktree index**. Document that in README. Manage a marked block only:

```
# >>> local-ignore (managed)
path/one
path/two
# <<< local-ignore
```

Rewrite that block from the **full** current `localIgnore.files` path list. Leave every other line in `exclude` untouched. Create `info/` if needed. If a path is already listed outside the block, do not duplicate it.
- Apply automatically on:
  - activation / startup (`onStartupFinished` + first `apply` in `activate`)
  - `onDidChangeWorkspaceFolders`
  - workspace trust granted
  - `localIgnore.*` settings change
  - **file created or changed** at a configured path (`vscode.workspace.createFileSystemWatcher` per git-root-relative path — so a `git pull` that writes the file back gets deleted again while the window is open)
  - **Git repository state change** while the window is open: subscribe to the built-in Git extension’s `API.repositories[].state.onDidChange` (and `onDidOpenRepository`) and debounce-apply (`DEBOUNCE_MS` 300). This covers checkout, pull, merge, and worktree switches done from the editor SCM UI.
- Re-create file watchers when workspace folders or `localIgnore.files` change.
- If the Git extension API is missing, still apply on startup/watchers; SCM-triggered reapply is best-effort.
- Commands:
  - **Local Ignore: Apply Now** (`localIgnore.apply`): re-runs the same apply logic.
  - **Local Ignore: Restore Path…** (`localIgnore.restore`): quick-pick from config; `--no-skip-worktree` (ignore non-zero), `git checkout -- <path>` if tracked, remove the path from the managed `exclude` block.
  - **Local Ignore: Unstick for Git** (`localIgnore.unstick`): clear skip-worktree and `git checkout --` those paths from `HEAD`.
- **Automate the skip-worktree vs pull fight** (`localIgnore.autoUnstick` boolean, default `true`). Git will not let an extension mutate the index *during* a pull (the index is locked; there is no pre-merge hook). Do this instead, on debounced `state.onDidChange` / after apply:
  1. If `HEAD` is behind `@{upstream}` **and** `git diff --name-only HEAD...@{upstream}` intersects configured paths **and** those paths still have skip-worktree → **unstick only those paths** (this is the “Git will refuse” pattern).
  2. If `localIgnore.autoRetryScmPull` is `true` (default `true`) **and** we just unstuck because of that pattern **and** we are not already retrying → `vscode.commands.executeCommand('git.pull')` **once**, then apply/delete again. Guard with a per-repo flag so it cannot loop.
  3. Do **not** `git pull` on behalf of an external terminal. After a failed CLI pull, still auto-unstick (step 1) so the user’s second `git pull` works. Log “unstuck, pull again”.
  4. Do **not** unstick on every fetch when the incoming diff does **not** touch configured paths. Leave skip-worktree on.
  5. Do **not** auto-resolve merge conflicts on other files. If pull still fails for unrelated reasons, stop retrying and log.
- User settings are the intended home. Workspace settings work but warn in the README that committing `.vscode/settings.json` shares the list.

## Non-goals (v1)

- Glob patterns / full gitignore syntax in v1 (exact file paths only, even inside `exclude`).
- Directories (reject paths that resolve to a directory; do not `rm -rf`).
- Absolute paths, `..` segments, `~`, env vars in `path`.
- Replacing Git hooks, husky, or Bold Agent.
- Running outside VS Code / Cursor (terminal `git worktree add` without opening the folder will not apply until the folder is opened).
- Wrapping `/usr/bin/git` or terminal aliases. CLI pull is auto-unstick + user retries, not a Git shim.
- Silently taking “theirs” on unrelated conflicted files.
- UI sidebar. Output Channel is enough.

## Safety

- Never `git add` a configured path to force skip-worktree.
- Never run `git rm --cached` / `git rm` / stage a removal. This extension never untracks a path for the team or touches history — that is a real, shared, committable change, the opposite of "local ignore." skip-worktree and exclude are index/config flags only.
- Never delete a directory (`rm -rf` is forbidden).
- If the path is tracked and skip-worktree failed (lock held, or any other error), do not unlink this round; log it and let the next debounced apply retry.
- Refuse paths outside the git root after `path.normalize` / resolve.
- Skip untrusted workspaces (`workspace.isTrusted === false`) until trust is granted.
- Skip folders that are not Git working trees.
- `localIgnore.enable` (boolean, default `true`) master switch.
- Log every apply/skip/error to an Output Channel named `Local Ignore`.

## Git invocation

- Spawn the Git executable (honor `git.path` from the built-in Git extension config when set; otherwise `git` on PATH).
- Per workspace folder: `cwd` = that folder, then `git rev-parse --show-toplevel` to get the repo root (linked worktrees included).
- Commands:
  - `git rev-parse --git-path info/exclude`
  - `git ls-files --error-unmatch -- <path>`
  - `git update-index --skip-worktree -- <path>`
  - `git update-index --no-skip-worktree -- <path>`
  - `git checkout -- <path>` (restore tracked only)
- Do not use `--no-verify` or change `core.hooksPath`.
- Quote paths so spaces work. `mcp.json` under `.cursor/` must work.

## Code conventions

- TypeScript strict. No `require()`. ES module or CJS — match the VS Code generator default; do not fight it.
- No UI framework. No webview in v1.
- Modules: `src/extension.ts` (apply / watchers / commands), `src/git.ts` (Git CLI), `src/paths.ts` (path validation), `src/exclude.ts` (managed exclude block). Keep the extension tiny.
- Core apply is `applyLocalIgnore` in `src/extension.ts`: resolve git root → for each config path: upsert exclude → try skip-worktree → optional unlink (with the tracked+failed-skip guard).
- Use the Git extension API only as a **signal** (repo opened / HEAD or index changed). Index flags and deletes still go through the Git CLI.

## Settings example (canonical)

```json
{
  "localIgnore.enable": true,
  "localIgnore.files": [
    { "path": ".cursor/mcp.json", "delete": true }
  ]
}
```

Put this in **User** settings. After apply, that checkout no longer has the project MCP file; the user must define servers in `~/.cursor/mcp.json` (Cursor) if they still want them.

## Verify

- Apply: exclude block contains the path; `git update-index --skip-worktree` either sets `S` or fails with “did not match” for untracked. `git status` does not list the path. Optional delete removes a file, not a directory.
- Restore: no skip-worktree, exclude line gone, tracked file restorable from HEAD.
