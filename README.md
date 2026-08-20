# Local Ignore

Hide paths from `git status` and commits **only on your machine**. Every apply does both:

- `.git/info/exclude` (local gitignore, not committed)
- `git update-index --skip-worktree` (hides **tracked** local changes)

Whichever does not apply, Git ignores. You do not choose.

Works in Visual Studio Code and Cursor (Install from VSIX or the Marketplace).

## When to use it

- A repo ships a **tracked** file you never want locally (project MCP config).
- You keep a **local-only untracked** file (scratch notes, a private env file the team did not gitignore).
- You use many Git worktrees and User settings, without committing `.gitignore`.

## Settings

User settings (recommended) or workspace settings:

```json
{
  "localIgnore.enable": true,
  "localIgnore.files": [
    { "path": ".cursor/mcp.json", "delete": true }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `path` | Path relative to the **Git repository root**. Use `/`, no `..`, no absolute paths. Files only. |
| `delete` | `false` (default): hide the path; keep the file on disk. `true`: hide, then delete the working-tree file. |

Tracked vs untracked: both levers, every time. Exclude is harmless on tracked files. skip-worktree is a no-op on untracked files.

Master switch: `localIgnore.enable` (default `true`).

**Cursor MCP example:** deleting `.cursor/mcp.json` in each checkout only makes sense if your servers live in the user-level Cursor MCP config (`~/.cursor/mcp.json`). Otherwise those project servers disappear in that window.

Prefer User settings. If you put this in `.vscode/settings.json` and commit it, everyone who clones the repo gets your ignore list.

## What it does while the editor is open

When you open a trusted Git folder, and again when folders or these settings change, Local Ignore for each configured path:

1. Writes the path into a managed block in `.git/info/exclude`.
2. Runs `git update-index --skip-worktree` (fine if Git says the path is not in the index).
3. If `delete` is true, deletes the file (not a directory).

It **re-applies** (debounced) if the file comes back, or after SCM checkout/pull/merge in this window.

**Worktrees:** `skip-worktree` is per checkout. `.git/info/exclude` is usually **shared** for the whole clone (every worktree).

## Commands

- **Local Ignore: Apply Now** — run the same logic without reloading the window.
- **Local Ignore: Restore Path…** — clear skip-worktree and/or remove the managed exclude line; restore tracked content from `HEAD` when applicable.
- **Local Ignore: Unstick for Git** — temporarily restore configured paths if you want to do it by hand. With defaults on, the extension unsticks those paths when you are behind upstream **and** the incoming commits touch them, then retries **SCM Pull** once. A failed terminal `git pull` still needs a second pull after the unstick.

Logs: **Output** panel → **Local Ignore**.

## What it will not do

- Untrack a file for the whole team or rewrite history. Exclude is local; skip-worktree is local. Neither is `git rm --cached`.
- Apply while the folder is closed.
- Delete directories or match globs (v1 is exact file paths).
- Inject into a `git pull` that is already running (index is locked). Defaults auto-unstick **after** Git refuses, then retry SCM Pull once. Terminal: unstick, then pull again. Turn off with `localIgnore.autoUnstick` / `localIgnore.autoRetryScmPull`.

## Install

Marketplace: search **Local Ignore** (when published).

From a VSIX:

1. Command Palette → **Extensions: Install from VSIX…**
2. Reload the window, add `localIgnore.files` to User settings, reopen the repo.

## Requirements

- Git on `PATH`, or `git.path` set like the built-in Git extension.
- A trusted workspace (VS Code / Cursor workspace trust).

## Privacy

The extension only runs `git` and optional local file deletes for paths you listed. It does not upload your repositories.

## License

MIT
