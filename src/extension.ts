import * as vscode from "vscode";
import { removeManagedPath, upsertManagedExclude } from "./exclude";
import {
  checkoutPath,
  getExcludePath,
  getGitExecutable,
  getRepoRoot,
  hasSkipWorktree,
  incomingNames,
  isHeadBehindUpstream,
  isTracked,
  noSkipWorktree,
  skipWorktree,
} from "./git";
import {
  isDirectory,
  isRegularFile,
  unlinkIfRegularFile,
  validateGitRootRelativePath,
} from "./paths";

export type LocalIgnoreFile = {
  path: string;
  delete?: boolean;
};

type Logger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

type GitRepository = {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
};

type GitAPI = {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
};

const DEBOUNCE_MS = 300;
const pullRetried = new Set<string>();
const holdApply = new Set<string>();
let output: vscode.OutputChannel | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let applying = false;
let applyAgain = false;
let fileWatchers: vscode.Disposable[] = [];
let gitStateSubs: vscode.Disposable[] = [];
let gitApi: GitAPI | undefined;

function log(message: string): void {
  const _line = `[${new Date().toISOString()}] ${message}`;
  output?.appendLine(_line);
}

function getLogger(): Logger {
  return { info: log, error: log };
}

function readFiles(): LocalIgnoreFile[] {
  const _raw = vscode.workspace.getConfiguration("localIgnore").get<unknown>("files") ?? [];
  if (!Array.isArray(_raw)) {
    return [];
  }
  const _out: LocalIgnoreFile[] = [];
  for (const _item of _raw) {
    if (!_item || typeof _item !== "object") {
      continue;
    }
    const _path = (_item as { path?: unknown }).path;
    if (typeof _path !== "string") {
      continue;
    }
    const _delete = (_item as { delete?: unknown }).delete;
    _out.push({
      path: _path,
      delete: _delete === true,
    });
  }
  return _out;
}

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration("localIgnore").get<boolean>("enable") !== false;
}

export async function applyLocalIgnore(
  folder: vscode.WorkspaceFolder,
  logger: Logger,
): Promise<void> {
  const _gitPath = getGitExecutable();
  const _gitRoot = await getRepoRoot(_gitPath, folder.uri.fsPath);
  if (!_gitRoot) {
    logger.info(`skip ${folder.uri.fsPath}: not a git working tree`);
    return;
  }
  if (holdApply.has(_gitRoot)) {
    logger.info(`skip ${_gitRoot}: apply held during unstick/pull`);
    return;
  }
  const _files = readFiles();
  const _valid: { relative: string; absolute: string; delete: boolean }[] = [];
  for (const _entry of _files) {
    const _check = validateGitRootRelativePath(_entry.path, _gitRoot);
    if (!_check.ok) {
      logger.info(`skip ${_entry.path}: ${_check.reason}`);
      continue;
    }
    if (await isDirectory(_check.absolute)) {
      logger.info(`skip ${_check.relative}: directories are not allowed`);
      continue;
    }
    _valid.push({
      relative: _check.relative,
      absolute: _check.absolute,
      delete: _entry.delete === true,
    });
  }
  const _excludeFile = await getExcludePath(_gitPath, _gitRoot);
  await upsertManagedExclude(
    _excludeFile,
    _valid.map((v) => v.relative),
  );
  logger.info(`exclude block updated (${_valid.length} path(s)) at ${_excludeFile}`);
  for (const _item of _valid) {
    const _skip = await skipWorktree(_gitPath, _gitRoot, _item.relative);
    if (_skip.code !== 0) {
      logger.info(
        `skip-worktree ${_item.relative}: non-zero (${_skip.code}) ${_skip.stderr.trim() || _skip.stdout.trim()}`,
      );
    } else {
      logger.info(`skip-worktree ${_item.relative}: ok`);
    }
    if (!_item.delete) {
      continue;
    }
    const _tracked = await isTracked(_gitPath, _gitRoot, _item.relative);
    if (_tracked && _skip.code !== 0) {
      logger.info(
        `delete skipped for tracked ${_item.relative}: skip-worktree failed (index may be locked)`,
      );
      continue;
    }
    if (!(await isRegularFile(_item.absolute))) {
      logger.info(`delete skipped for ${_item.relative}: not a regular file on disk`);
      continue;
    }
    await unlinkIfRegularFile(_item.absolute);
    logger.info(`deleted ${_item.relative}`);
  }
}

async function applyAll(reason: string): Promise<void> {
  if (applying) {
    applyAgain = true;
    return;
  }
  applying = true;
  try {
    do {
      applyAgain = false;
      log(`apply: ${reason}`);
      if (!vscode.workspace.isTrusted) {
        log("skip: workspace is not trusted");
        return;
      }
      if (!isEnabled()) {
        log("skip: localIgnore.enable is false");
        return;
      }
      const _folders = vscode.workspace.workspaceFolders ?? [];
      if (_folders.length === 0) {
        log("skip: no workspace folders");
        return;
      }
      for (const _folder of _folders) {
        try {
          await applyLocalIgnore(_folder, getLogger());
          await maybeAutoUnstick(_folder);
        } catch (err) {
          log(`error in ${_folder.uri.fsPath}: ${String(err)}`);
        }
      }
    } while (applyAgain);
  } finally {
    applying = false;
  }
}

function scheduleApply(reason: string): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void applyAll(reason);
  }, DEBOUNCE_MS);
}

async function maybeAutoUnstick(folder: vscode.WorkspaceFolder): Promise<void> {
  const _cfg = vscode.workspace.getConfiguration("localIgnore");
  if (_cfg.get<boolean>("autoUnstick") === false) {
    return;
  }
  const _gitPath = getGitExecutable();
  const _gitRoot = await getRepoRoot(_gitPath, folder.uri.fsPath);
  if (!_gitRoot) {
    return;
  }
  if (!(await isHeadBehindUpstream(_gitPath, _gitRoot))) {
    pullRetried.delete(_gitRoot);
    return;
  }
  const _incoming = new Set(await incomingNames(_gitPath, _gitRoot));
  if (_incoming.size === 0) {
    return;
  }
  const _toUnstick: string[] = [];
  for (const _entry of readFiles()) {
    const _check = validateGitRootRelativePath(_entry.path, _gitRoot);
    if (!_check.ok) {
      continue;
    }
    if (!_incoming.has(_check.relative)) {
      continue;
    }
    if (!(await hasSkipWorktree(_gitPath, _gitRoot, _check.relative))) {
      continue;
    }
    _toUnstick.push(_check.relative);
  }
  if (_toUnstick.length === 0) {
    log(`${_gitRoot}: behind upstream, incoming diff does not touch skip-worktree paths`);
    return;
  }
  log(
    `${_gitRoot}: unstick for incoming pull: ${_toUnstick.join(", ")} (pull again if this was a terminal git pull)`,
  );
  for (const _rel of _toUnstick) {
    const _cleared = await noSkipWorktree(_gitPath, _gitRoot, _rel);
    if (_cleared.code !== 0) {
      log(`no-skip-worktree ${_rel}: ${_cleared.stderr.trim() || _cleared.stdout.trim()}`);
    }
  }
  if (_cfg.get<boolean>("autoRetryScmPull") === false) {
    return;
  }
  if (pullRetried.has(_gitRoot)) {
    log(`${_gitRoot}: already retried SCM pull for this behind-upstream episode`);
    return;
  }
  pullRetried.add(_gitRoot);
  holdApply.add(_gitRoot);
  try {
    log(`${_gitRoot}: retrying SCM pull once`);
    await vscode.commands.executeCommand("git.pull");
  } catch (err) {
    log(`${_gitRoot}: SCM pull retry failed (not retrying again): ${String(err)}`);
  } finally {
    holdApply.delete(_gitRoot);
  }
  await applyLocalIgnore(folder, getLogger());
}

async function restorePath(relativeHint?: string): Promise<void> {
  const _files = readFiles();
  if (_files.length === 0) {
    void vscode.window.showInformationMessage("Local Ignore: no paths in localIgnore.files");
    return;
  }
  let _picked = relativeHint;
  if (!_picked) {
    const _choice = await vscode.window.showQuickPick(
      _files.map((f) => f.path),
      { placeHolder: "Restore which configured path?" },
    );
    _picked = _choice;
  }
  if (!_picked) {
    return;
  }
  const _gitPath = getGitExecutable();
  const _folders = vscode.workspace.workspaceFolders ?? [];
  for (const _folder of _folders) {
    const _gitRoot = await getRepoRoot(_gitPath, _folder.uri.fsPath);
    if (!_gitRoot) {
      continue;
    }
    const _check = validateGitRootRelativePath(_picked, _gitRoot);
    if (!_check.ok) {
      log(`restore skip ${_picked} in ${_gitRoot}: ${_check.reason}`);
      continue;
    }
    const _noSkip = await noSkipWorktree(_gitPath, _gitRoot, _check.relative);
    if (_noSkip.code !== 0) {
      log(`restore no-skip-worktree ${_check.relative}: non-zero (ignored)`);
    }
    if (await isTracked(_gitPath, _gitRoot, _check.relative)) {
      const _co = await checkoutPath(_gitPath, _gitRoot, _check.relative);
      if (_co.code !== 0) {
        log(`restore checkout ${_check.relative}: ${_co.stderr.trim() || _co.stdout.trim()}`);
      } else {
        log(`restore checkout ${_check.relative}: ok`);
      }
    }
    const _excludeFile = await getExcludePath(_gitPath, _gitRoot);
    await removeManagedPath(_excludeFile, _check.relative);
    log(`restore removed ${_check.relative} from exclude block (next apply will put it back if still in settings)`);
  }
}

async function unstickAll(): Promise<void> {
  const _gitPath = getGitExecutable();
  const _folders = vscode.workspace.workspaceFolders ?? [];
  for (const _folder of _folders) {
    const _gitRoot = await getRepoRoot(_gitPath, _folder.uri.fsPath);
    if (!_gitRoot) {
      continue;
    }
    for (const _entry of readFiles()) {
      const _check = validateGitRootRelativePath(_entry.path, _gitRoot);
      if (!_check.ok) {
        continue;
      }
      const _noSkip = await noSkipWorktree(_gitPath, _gitRoot, _check.relative);
      if (_noSkip.code !== 0) {
        log(`unstick no-skip-worktree ${_check.relative}: non-zero (ignored)`);
      }
      if (await isTracked(_gitPath, _gitRoot, _check.relative)) {
        const _co = await checkoutPath(_gitPath, _gitRoot, _check.relative);
        if (_co.code !== 0) {
          log(`unstick checkout ${_check.relative}: ${_co.stderr.trim() || _co.stdout.trim()}`);
        } else {
          log(`unstick checkout ${_check.relative}: ok`);
        }
      }
    }
  }
}

async function rebuildFileWatchers(): Promise<void> {
  for (const _d of fileWatchers) {
    _d.dispose();
  }
  fileWatchers = [];
  if (!vscode.workspace.isTrusted || !isEnabled()) {
    return;
  }
  const _gitPath = getGitExecutable();
  const _folders = vscode.workspace.workspaceFolders ?? [];
  const _seen = new Set<string>();
  for (const _folder of _folders) {
    const _gitRoot = await getRepoRoot(_gitPath, _folder.uri.fsPath);
    if (!_gitRoot) {
      continue;
    }
    for (const _entry of readFiles()) {
      const _check = validateGitRootRelativePath(_entry.path, _gitRoot);
      if (!_check.ok) {
        continue;
      }
      const _key = `${_gitRoot}::${_check.relative}`;
      if (_seen.has(_key)) {
        continue;
      }
      _seen.add(_key);
      const _pattern = new vscode.RelativePattern(_gitRoot, _check.relative);
      const _watcher = vscode.workspace.createFileSystemWatcher(_pattern);
      fileWatchers.push(
        _watcher,
        _watcher.onDidCreate(() => scheduleApply(`file created ${_check.relative}`)),
        _watcher.onDidChange(() => scheduleApply(`file changed ${_check.relative}`)),
      );
    }
  }
}

function bindGitRepository(repo: GitRepository): void {
  const _sub = repo.state.onDidChange(() => {
    scheduleApply(`git state changed ${repo.rootUri.fsPath}`);
  });
  gitStateSubs.push(_sub);
}

async function bindGitApi(context: vscode.ExtensionContext): Promise<void> {
  const _ext = vscode.extensions.getExtension("vscode.git");
  if (!_ext) {
    log("git extension missing; SCM-triggered reapply is best-effort off");
    return;
  }
  const _exports = _ext.isActive ? _ext.exports : await _ext.activate();
  gitApi = _exports?.getAPI?.(1) as GitAPI | undefined;
  if (!gitApi) {
    log("git API unavailable");
    return;
  }
  for (const _repo of gitApi.repositories) {
    bindGitRepository(_repo);
  }
  context.subscriptions.push(
    gitApi.onDidOpenRepository((repo) => {
      bindGitRepository(repo);
      scheduleApply(`git repo opened ${repo.rootUri.fsPath}`);
    }),
  );
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("Local Ignore");
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand("localIgnore.apply", () => applyAll("command")),
    vscode.commands.registerCommand("localIgnore.restore", () => restorePath()),
    vscode.commands.registerCommand("localIgnore.unstick", () => unstickAll()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void rebuildFileWatchers();
      scheduleApply("workspace folders changed");
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("localIgnore")) {
        return;
      }
      void rebuildFileWatchers();
      scheduleApply("localIgnore settings changed");
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void rebuildFileWatchers();
      scheduleApply("workspace trust granted");
    }),
    {
      dispose: () => {
        for (const _d of fileWatchers) {
          _d.dispose();
        }
        fileWatchers = [];
        for (const _d of gitStateSubs) {
          _d.dispose();
        }
        gitStateSubs = [];
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
      },
    },
  );
  void bindGitApi(context);
  void rebuildFileWatchers();
  void applyAll("activation");
}

export function deactivate(): void {
  // nothing
}
