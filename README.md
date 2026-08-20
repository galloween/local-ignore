# Local Ignore

Hide files from `git status` and commits **on this machine only**. The rest of the team is unchanged.

Every apply does both:

- write the path into `.git/info/exclude` (local ignore list; not committed)
- run `git update-index --skip-worktree` (hides **tracked** files)

Git uses whichever of those applies. You do not pick.

Works in **Visual Studio Code** and **Cursor**. Search **Local Ignore** in the Extensions panel.

## When to use it

- The repo tracks a file you never want locally (for example project `.cursor/mcp.json`).
- You keep an untracked private file the team did not gitignore.
- You use several Git worktrees and want one ignore list in **User** settings, not a committed `.gitignore`.

## Install

1. Extensions panel → search **Local Ignore** → Install.  
   VS Code uses the Visual Studio Marketplace; Cursor uses Open VSX. Same extension id: `galloween.local-ignore`.
2. Add `localIgnore.files` to **User** settings (see below).
3. Open a **trusted** Git folder. Check **Output** → **Local Ignore**.

To install a `.vsix` by hand: Command Palette → **Extensions: Install from VSIX…**

## Settings

Prefer **User** settings. Workspace settings work, but if you commit `.vscode/settings.json`, everyone who clones the repo gets your list.

```json
{
  "localIgnore.enable": true,
  "localIgnore.files": [
    { "path": ".cursor/mcp.json", "delete": true }
  ]
}
```

| Setting | Meaning |
| --- | --- |
| `localIgnore.files` | List of files to hide. |
| `path` | Relative to the **Git repository root** (not the VS Code folder, if those differ). Use `/`. Files only — no directories, globs, `..`, or absolute paths. |
| `delete` | `false` (default): hide the path, leave the file on disk. `true`: hide, then delete the working-tree file. |
| `localIgnore.enable` | Master switch. Default `true`. |
| `localIgnore.autoUnstick` | Default `true`. Temporarily clear skip-worktree when incoming commits touch those paths so Git can pull. |
| `localIgnore.autoRetryScmPull` | Default `true`. After that unstick, run **SCM Pull** once. Does not pull for a failed terminal `git pull`. |

**Cursor MCP:** `delete: true` on `.cursor/mcp.json` only makes sense if your servers live in `~/.cursor/mcp.json`. Otherwise that window loses the project MCP servers.

## What it does

On a trusted Git folder — at startup, when folders or `localIgnore.*` settings change, when a listed file is created or changed, and after SCM checkout/pull/merge in this window — for each configured path:

1. Writes the path into a managed block in `.git/info/exclude`.
2. Runs `git update-index --skip-worktree` (safe if Git says the path is not in the index).
3. If `delete` is true, deletes the file (never a directory).

**Worktrees:** skip-worktree is per checkout. `.git/info/exclude` is usually **shared** for the whole clone.

## Pulls

Git will not update skip-worktree files while the index is locked. If you are behind upstream **and** the incoming commits touch a configured path, Local Ignore clears skip-worktree on **those** paths only, then retries **SCM Pull** once (defaults on).

A failed **terminal** `git pull` is not retried for you. After the unstick, pull again. Turn this off with `localIgnore.autoUnstick` / `localIgnore.autoRetryScmPull`.

## Commands

- **Local Ignore: Apply Now** — run the same hide logic now.
- **Local Ignore: Restore Path…** — pick a configured path: clear skip-worktree, restore tracked content from `HEAD` if needed, remove it from the managed exclude block. The next apply puts it back if it is still in settings.
- **Local Ignore: Unstick for Git** — clear skip-worktree and check those paths out from `HEAD` (manual).

Logs: **Output** → **Local Ignore**.

## Limits

- Does not untrack a file for the team (`git rm --cached`) or rewrite history. Exclude and skip-worktree stay on your machine.
- Does nothing while the folder is closed, or in an untrusted workspace.
- Exact file paths only. No globs, no directories.
- Does not finish a `git pull` that is already running.

## Requirements

- Git on `PATH`, or `git.path` set the same way as the built-in Git extension.
- Workspace trust granted.

## Privacy

The extension runs `git` and optional local deletes for paths you listed. It does not upload your repositories.

## License

MIT
