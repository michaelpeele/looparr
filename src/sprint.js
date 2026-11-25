'use strict';

// Sprint/phase git orchestration (DESIGN-sprints-phases.md R2/R5/R6).
// Pure spawnSync helpers: every function returns raw git output and the caller
// (engine) redacts and wraps it. Guards baked in here:
//   - only `looparr/*` branches are ever created or merged,
//   - nothing is pushed and no remote is touched,
//   - the live checkout is never switched (all merges run inside worktrees),
//   - failures are reported, never cleaned up behind the caller's back.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRANCH_PREFIX = 'looparr/';
const MERGE_TIMEOUT_MS = 60_000;
const VALIDATION_TIMEOUT_MS = 15 * 60_000;

function slug(text, maxLength = 40) {
  const slugified = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slugified || 'task';
}

// Stable per-project/per-sprint id for the .looparr/sruns/<runId> directory.
function runIdFor(projectId, sprint) {
  return slug(`${projectId || 'project'}-${sprint || 'sprint'}`, 80);
}

function assertLooparrBranch(branch) {
  const name = String(branch || '');
  if (!name.startsWith(BRANCH_PREFIX) || name.includes('..') || name.includes(' ')) {
    throw new Error(`Refusing non-looparr branch: ${name || '(empty)'}`);
  }
  return name;
}

// Raw git result shaped as { ok, status, stdout, stderr }.
function git(repo, args, options = {}) {
  let result;
  try {
    result = spawnSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      timeout: options.timeoutMs || MERGE_TIMEOUT_MS
    });
  } catch (error) {
    return { ok: false, status: -1, stdout: '', stderr: String(error.message || error) };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
}

function listBranches(repo, pattern) {
  const args = ['branch', '--list'];
  if (pattern) args.push(pattern);
  const result = git(repo, args);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^\*?\s+/, '').trim())
    .filter(Boolean);
}

function branchExists(repo, branch) {
  return listBranches(repo, branch).length > 0;
}

function currentBranch(repo) {
  const result = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.ok ? result.stdout.trim() : '';
}

// main first, then master; '' when neither exists.
function mainBranchFor(repo) {
  const branches = new Set(listBranches(repo));
  for (const candidate of ['main', 'master']) {
    if (branches.has(candidate)) return candidate;
  }
  return '';
}

// branchForTask: `looparr/task/<sprint>/<task-slug>` with `-2`, `-3` collision
// suffixes against branches that already exist on disk (R2).
function branchForTask(repo, sprint, taskText) {
  const sprintSlug = slug(sprint, 40);
  const base = `looparr/task/${sprintSlug}/${slug(taskText, 40)}`;
  assertLooparrBranch(base);
  let candidate = base;
  let counter = 2;
  while (branchExists(repo, candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function sprintBranchFor(sprint) {
  return assertLooparrBranch(`looparr/sprint/${slug(sprint, 40)}`);
}

function taskBranchForSprintOf(branch) {
  // looparr/task/<sprint>/<slug> -> <sprint>; '' when not a task branch.
  const match = String(branch || '').match(/^looparr\/task\/([^/]+)\//);
  return match ? match[1] : '';
}

// Worktrees live under the project: .looparr/sruns/<runId>/task-<taskIndex>.
function taskWorktreePath(projectPath, runId, taskIndex) {
  return path.join(projectPath, '.looparr', 'sruns', runId, `task-${taskIndex}`);
}

function sprintWorktreePath(projectPath, runId) {
  return path.join(projectPath, '.looparr', 'sruns', runId, 'sprint');
}

function mainWorktreePath(projectPath, runId) {
  return path.join(projectPath, '.looparr', 'sruns', runId, 'main');
}

// Worktrees other than the repo root itself, for reuse checks.
function worktreePathsWithin(root) {
  const result = git(root, ['worktree', 'list', '--porcelain']);
  if (!result.ok) return [];
  const paths = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      const worktree = line.slice('worktree '.length).trim();
      if (worktree !== root) paths.push(worktree);
    }
  }
  return paths;
}

// Cut a new task branch at `base` and check it out in its own worktree. The
// live checkout is never switched; `git worktree add` writes a separate index.
function addTaskWorktree(repo, worktreePath, branch, base) {
  assertLooparrBranch(branch);
  let okBase = base;
  if (!okBase) okBase = currentBranch(repo) || 'HEAD';
  const result = git(repo, ['worktree', 'add', '-b', branch, worktreePath, okBase]);
  return {
    ok: result.ok,
    branch,
    worktree: worktreePath,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

// Create (or reuse) the sprint integration worktree on `looparr/sprint/<name>`.
// Existing worktree wins over branch naming so a rerun keeps merging in place.
function ensureSprintWorktree(repo, worktreePath, branch, base) {
  assertLooparrBranch(branch);
  const existing = worktreePathsWithin(repo);
  const present = fs.existsSync(worktreePath);
  if (!present) {
    const created = git(repo, ['worktree', 'add', worktreePath, branch]);
    if (!created.ok) {
      // Branch may not exist yet: cut it from base and retry once.
      if (!branchExists(repo, branch)) {
        const created2 = git(repo, ['worktree', 'add', '-b', branch, worktreePath, base || 'HEAD']);
        if (!created2.ok) {
          return { ok: false, stdout: created.stdout, stderr: created.stderr || created2.stderr };
        }
      } else {
        return { ok: false, stdout: created.stdout, stderr: created.stderr };
      }
    }
  }
  return { ok: true, stdout: '', stderr: existing.includes(worktreePath) ? 'reused' : '' };
}

function removeWorktree(repo, worktreePath) {
  // Never --force and never against a missing dir: failures are reported and
  // the caller keeps the branches for review (R6).
  const result = git(repo, ['worktree', 'remove', worktreePath]);
  return { ok: result.ok, stdout: result.stdout, stderr: result.stderr };
}

// Local merge of one branch into the HEAD of a worktree (never the live
// checkout). A conflict aborts the merge and reports; the branch and
// worktree stay on disk for manual review (R5/R6).
function mergeBranchInWorktree(worktreePath, branch, message) {
  assertLooparrBranch(branch);
  let result;
  try {
    result = spawnSync('git', ['merge', '--no-ff', '-m', message || `looparr: merge ${branch}`, branch], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: MERGE_TIMEOUT_MS
    });
  } catch (error) {
    return { ok: false, status: -1, stdout: '', stderr: String(error.message || error) };
  }
  const out = {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || '')
  };
  if (!out.ok) {
    // Abort the conflicted merge; branches and worktree remain for review.
    try {
      spawnSync('git', ['merge', '--abort'], { cwd: worktreePath, encoding: 'utf8', timeout: MERGE_TIMEOUT_MS });
      out.aborted = true;
    } catch { /* leave the conflicted state visible */ }
  }
  return out;
}

// Merge a list of task branches (already in order) into the worktree's HEAD.
// Stops at the first failure and reports which branch conflicted.
function mergeTaskBranches(worktreePath, branches, messagePrefix) {
  const merged = [];
  let error = '';
  let output = '';
  for (const branch of branches || []) {
    const result = mergeBranchInWorktree(worktreePath, branch, `${messagePrefix || 'looparr'}: merge ${branch}`);
    output += result.stdout + result.stderr;
    if (!result.ok) {
      error = `Merge failed for ${branch}`;
      break;
    }
    merged.push(branch);
  }
  return { ok: !error, merged, error, output };
}

// Merge a looparr branch into the project main branch, locally only (R5).
// main is checked out in a side worktree because the live checkout must not
// switch; when main is the live checkout's branch, that side worktree cannot
// exist and the merge is refused with a manual instruction.
function mergeIntoMain(repo, projectPath, runId, branch) {
  assertLooparrBranch(branch);
  const main = mainBranchFor(repo);
  if (!main) {
    return { ok: false, error: `Merge to main failed for ${branch}`, output: 'no main or master branch in the repository', conflict: false };
  }
  const live = currentBranch(repo);
  if (live === main) {
    return {
      ok: false,
      error: `Merge to main failed for ${branch}`,
      output: `main (${main}) is checked out in the live checkout; merge ${branch} manually with git merge --no-ff ${branch}`,
      conflict: false
    };
  }
  const worktreePath = mainWorktreePath(projectPath, runId);
  if (!fs.existsSync(worktreePath)) {
    const added = git(repo, ['worktree', 'add', worktreePath, main]);
    if (!added.ok) {
      return { ok: false, error: `Merge to main failed for ${branch}`, output: added.stderr, conflict: false };
    }
  }
  const result = mergeBranchInWorktree(worktreePath, branch, `looparr: merge ${branch} to ${main}`);
  if (!result.ok) {
    return { error: `Merge to main failed for ${branch}`, ok: false, output: result.stdout + result.stderr, conflict: Boolean(result.aborted) };
  }
  return { ok: true, output: result.stdout + result.stderr, main, worktree: worktreePath };
}

// The validation round: run `sprintTestCommand` in the sprint integration
// worktree. Output is returned raw; the engine redacts and wraps it.
function runSprintValidation(worktreePath, command, options = {}) {
  const cmd = String(command || '').trim() || 'npm test';
  let result;
  try {
    result = spawnSync('sh', ['-c', cmd], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: options.timeoutMs || VALIDATION_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CI: '1' }
    });
  } catch (error) {
    return { ok: false, exitCode: -1, output: String(error.message || error), timedOut: false, command: cmd };
  }
  return {
    ok: result.status === 0,
    exitCode: result.status,
    output: String(result.stdout || '') + String(result.stderr || ''),
    timedOut: result.error && result.error.code === 'ETIMEDOUT',
    command: cmd
  };
}

module.exports = {
  BRANCH_PREFIX,
  slug,
  runIdFor,
  assertLooparrBranch,
  listBranches,
  branchExists,
  currentBranch,
  mainBranchFor,
  branchForTask,
  sprintBranchFor,
  taskBranchForSprintOf,
  taskWorktreePath,
  sprintWorktreePath,
  mainWorktreePath,
  worktreePathsWithin,
  addTaskWorktree,
  ensureSprintWorktree,
  removeWorktree,
  mergeBranchInWorktree,
  mergeTaskBranches,
  mergeIntoMain,
  runSprintValidation
};
