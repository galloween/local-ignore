---
name: local-ignore
description: >-
  Hide files from git status and commits on this machine only via .git/info/exclude
  plus skip-worktree. Never git add or git rm --cached those paths. Use when the
  user asks to local-ignore, locally hide, or stop committing a file; before
  add/commit/push/pull/merge; when Git reports local changes would be overwritten
  while git status is clean; skip-worktree; or .cursor/mcp.json.
---

# Local Ignore

Keep listed files off `git status` and commits **on this clone only**. Not a shared `.gitignore`.

Every hide does both:

1. Upsert the path in the managed block of `.git/info/exclude` (not committed).
2. `git update-index --skip-worktree -- PATH` (no-op if the path is not in the index — that is fine).

Never `git add` a path to make skip-worktree apply.

## Add a file (user request)

Triggers: “local ignore this”, “don’t commit PATH on my machine”, “hide PATH from git locally”, “add PATH to local-ignore”.

1. `git rev-parse --show-toplevel` then make `PATH` git-root-relative. Use `/`. Refuse directories, `..`, `~`, absolute paths, env vars.
2. Upsert `PATH` into the managed exclude block (below). Create `info/` if needed. Do not duplicate a line that already exists **outside** the block.
3. `git update-index --skip-worktree -- PATH` (ignore non-zero / “did not match”).
4. Delete the working-tree file **only** if the user asked to delete it. Regular files only — never `rm -rf`.

Confirm with `git ls-files -v -- PATH` (`S` = skip-worktree on a tracked file) and `git status` (path should not appear).

## Remove a file from local-ignore

Triggers: “stop local-ignoring PATH”, “I want Git’s copy back”.

```bash
git update-index --no-skip-worktree -- PATH
git checkout -- PATH
```

(`checkout` only if tracked; skip `checkout` if they want to keep the disk file.) Remove `PATH` from the managed exclude block.

## Managed exclude block

```bash
git rev-parse --git-path info/exclude
```

```
# >>> local-ignore (managed)
.cursor/mcp.json
# <<< local-ignore
```

Rewrite **only** that block from the current list. Leave every other line in `exclude` untouched.

If the block is missing, there is no list yet — ask which path to hide, or add one as above. Do not create a committed `.local-ignore.json`.

## Hard rules

- Never `git add` / `update-index --add` a listed path to force skip-worktree.
- Never `git rm` / `git rm --cached` a listed path.
- Never delete a directory.
- Do not wrap `git pull`. Clear skip-worktree, pull, then skip-worktree again.
- Do not pick ours/theirs or `git add` for an unrelated merge conflict.

## Before add / commit / push

Do not stage paths in the managed block. If already staged: `git restore --staged -- PATH`.

## Pull blocked, `git status` clean

`git ls-files -v -- PATH` starts with `S`. Git will not overwrite that file.

```bash
git update-index --no-skip-worktree -- PATH
git pull
git update-index --skip-worktree -- PATH
```

Do **not** `git checkout -- PATH` unless the user wants to throw away local edits and take `HEAD`.

If pull still fails with a real conflict, the user resolves it. Then hide again (exclude + skip-worktree).
