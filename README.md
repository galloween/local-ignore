# Local Ignore

Hide files from `git status` and commits **on this machine only**. The rest of the team is unchanged.

Every apply does both:

- write the path into `.git/info/exclude` (local ignore list; not committed)
- run `git update-index --skip-worktree` (hides **tracked** files)

Git uses whichever of those applies. You do not pick.

Works in **Visual Studio Code** and **Cursor**. Search **Local Ignore** in the Extensions panel (`galloween.local-ignore`).

## When to use it

- The repo tracks a file you never want locally (for example project `.cursor/mcp.json`).
- You keep an untracked private file the team did not gitignore.
- You use several Git worktrees and want one ignore list in **User** settings, not a committed `.gitignore`.

## Install

1. Extensions panel → search **Local Ignore** → Install.
2. Add `localIgnore.files` to **User** settings (below).
3. Open a **trusted** Git folder. Check **Output** → **Local Ignore**.

`.vsix` by hand: Command Palette → **Extensions: Install from VSIX…**

## Settings

Prefer **User** settings. If you put this in `.vscode/settings.json` and commit it, everyone who clones the repo gets your list.

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
| `localIgnore.files` | Files to hide. |
| `path` | Relative to the **Git repository root** (not the VS Code folder, if those differ). Use `/`. Files only — no directories, globs, `..`, or absolute paths. |
| `delete` | `false` (default): hide, leave the file on disk. `true`: hide, then delete the working-tree file. |
| `localIgnore.enable` | Master switch. Default `true`. |
| `localIgnore.autoUnstick` | Default `true`. When incoming commits touch a hidden **tracked** path, temporarily clear skip-worktree so Git may update that file. |
| `localIgnore.autoRetryScmPull` | Default `true`. After that, run the editor **Git: Pull** once. Does **not** re-run a failed terminal `git pull`. |

**Cursor MCP:** `delete: true` on `.cursor/mcp.json` only makes sense if your servers live in `~/.cursor/mcp.json`. Otherwise that window loses the project MCP servers.

## What it does

On a trusted Git folder — at startup, when folders or `localIgnore.*` settings change, when a listed file is created or changed, and after SCM checkout/pull/merge in this window — for each configured path:

1. Writes the path into a managed block in `.git/info/exclude`.
2. Runs `git update-index --skip-worktree` (fine if Git says the path is not in the index).
3. If `delete` is true, deletes the file (never a directory).

**Worktrees:** skip-worktree is per checkout. `.git/info/exclude` is usually **shared** for the whole clone.

Logs: **Output** → **Local Ignore**.

## Commands

| Command | What it does |
| --- | --- |
| **Local Ignore: Apply Now** | Hide again (exclude + skip-worktree, then optional delete). |
| **Local Ignore: Unstick for Git** | Let Git see the configured **tracked** files: clear skip-worktree **and** `git checkout --` them from `HEAD` (discards local edits on those files). |
| **Local Ignore: Restore Path…** | Pick one path: same Git reset as unstick for that file, **and** remove it from the managed exclude block. Next apply puts it back if it is still in settings. |

## Git recipes

Replace `.cursor/mcp.json` with your `path`. Run Git from the **repository root**.

### See if a tracked file is hidden

Skip-worktree hides it from `git status`. Pull/merge can still say “local changes would be overwritten” while status looks clean.

**Editor:** **Output** → **Local Ignore**.

**Terminal:**

```bash
git ls-files -v -- .cursor/mcp.json
```

A line starting with `S` means skip-worktree. List all of them:

```bash
git ls-files -v | grep '^S'
```

### Hide it again

**Editor:** **Local Ignore: Apply Now**.

**Terminal** (tracked files only; skip-worktree does nothing useful on untracked files):

```bash
git update-index --skip-worktree -- .cursor/mcp.json
```

That does **not** rewrite `.git/info/exclude`. Prefer **Apply Now** so both levers stay in sync.

Never `git add` a configured path to “make skip-worktree work.” If Git says the path did not match, it is untracked; exclude is the lever that matters.

### Pull or merge is blocked (status is empty)

Git will not overwrite a skip-worktree file. The extension cannot change the index **during** a pull (the index is locked).

**In the editor (defaults on):** after fetch, if you are behind upstream **and** incoming commits touch that path, Local Ignore clears skip-worktree on **those** paths only, then runs **Git: Pull** once, then hides again. Watch the Output channel.

**Terminal `git pull` failed:** the extension still clears the flag when it can. It will **not** re-run your terminal pull. Then:

```bash
git update-index --no-skip-worktree -- .cursor/mcp.json
git pull
```

Then **Apply Now** (or wait for the automatic apply).

**Or** Command Palette → **Local Ignore: Unstick for Git**, then pull. That also runs `git checkout --` on the path, so **local edits to that file are thrown away**. Auto-clear (above) does **not** check out; it only removes the flag.

Turn the automation off with `localIgnore.autoUnstick` / `localIgnore.autoRetryScmPull`.

### I want Git’s copy of the file back

**Editor:** **Local Ignore: Restore Path…** and pick the file. Also remove it from `localIgnore.files` if you do not want the next apply to hide it again.

**Terminal:**

```bash
git update-index --no-skip-worktree -- .cursor/mcp.json
git checkout -- .cursor/mcp.json
```

Then delete that line from the managed block in the exclude file (or the next **Apply Now** will put it back):

```bash
git rev-parse --git-path info/exclude
```

The block looks like:

```
# >>> local-ignore (managed)
.cursor/mcp.json
# <<< local-ignore
```

### Real merge conflict (after the flag is already off)

That is a normal conflict, not skip-worktree. Resolve the file yourself. This extension will not choose ours/theirs and will not `git add` for you.

When the merge is finished, **Apply Now**.

Do **not** `git rm --cached` to “ignore” the file. That untracks it for everyone.

## Agent skill

Same Git moves, no editor required. The skill in `skills/local-ignore/` is self-contained: it writes the managed exclude block and skip-worktree itself.

```bash
cp -R skills/local-ignore ~/.agents/skills/local-ignore
ln -s ~/.agents/skills/local-ignore ~/.claude/skills/local-ignore   # optional
```

Tell the agent: **local ignore PATH** (and “delete it on disk” only if you want unlink). **Stop local-ignoring PATH** to reverse.

It is not a Git hook. It only runs when an agent is doing Git and actually loads the skill. A terminal `git pull` on its own does nothing.

## Limits

- Does nothing while the folder is closed, or in an untrusted workspace.
- Exact file paths only. No globs, no directories.
- Does not wrap `/usr/bin/git`. Terminal pull is: clear the flag, then you pull again.

## Requirements

- Git on `PATH`, or `git.path` set the same way as the built-in Git extension.
- Workspace trust granted.

## Privacy

The extension runs `git` and optional local deletes for paths you listed. It does not upload your repositories.

## License

MIT
