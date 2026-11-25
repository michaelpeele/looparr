'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const sprint = require(`${REPO_ROOT}/src/sprint`);

let pass = 0;
function run(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    throw error;
  }
}

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertOk(condition, label) {
  assert.ok(condition, label);
}

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-sprint-branches-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Looparr Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'seed']);
  return dir;
}

function testBranchNamingAndGuards() {
  assertEqual(sprint.slug('Backend API!!', 40), 'backend-api', 'slugifies sprint names');
  assertEqual(sprint.sprintBranchFor('Backend'), 'looparr/sprint/backend', 'sprint branch name');
  assertEqual(sprint.taskBranchForSprintOf('looparr/task/backend/add-api'), 'backend', 'sprint extracted from task branch');
  assertEqual(sprint.taskBranchForSprintOf('main'), '', 'non-task branch yields no sprint');
  assert.throws(() => sprint.assertLooparrBranch('main'), /Refusing non-looparr branch/, 'plain main refused');
  assert.throws(() => sprint.assertLooparrBranch('origin/main'), /Refusing non-looparr branch/, 'remote-tracking branch refused');
  assert.throws(() => sprint.assertLooparrBranch('looparr/two words'), /Refusing non-looparr branch/, 'branch with space refused');
  assert.throws(() => sprint.assertLooparrBranch(''), /Refusing non-looparr branch/, 'empty branch refused');
  assertEqual(sprint.assertLooparrBranch('looparr/task/x/y'), 'looparr/task/x/y', 'looparr branch accepted');
}

function testBranchForTaskCollision() {
  const repo = makeTempRepo();
  try {
    git(repo, ['branch', 'looparr/task/backend/add-api']);
    assertEqual(sprint.branchForTask(repo, 'backend', 'add api'), 'looparr/task/backend/add-api-2', 'collision suffix -2');
    git(repo, ['branch', 'looparr/task/backend/add-api-2']);
    git(repo, ['branch', 'looparr/task/backend/add-api-3']);
    assertEqual(sprint.branchForTask(repo, 'backend', 'add api'), 'looparr/task/backend/add-api-4', 'collision counter walks forward');
    git(repo, ['branch', 'looparr/task/backend/walk-suffix-6']);
    assertEqual(sprint.existingTaskBranch(repo, 'backend', 'walk suffix'), 'looparr/task/backend/walk-suffix-6', 'existingTaskBranch finds unbounded collision suffixes');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testWorktreeAddAndRemove() {
  const repo = makeTempRepo();
  try {
    const worktree = sprint.taskWorktreePath(repo, sprint.runIdFor('proj1', 'backend'), 0);
    assertOk(worktree.includes(`${path.sep}.looparr${path.sep}sprints${path.sep}`), 'worktrees live under .looparr/sprints');
    const added = sprint.addTaskWorktree(repo, worktree, 'looparr/task/backend/add-api', 'main');
    assertOk(added.ok, `worktree add succeeds: ${added.stderr}`);
    assertOk(fs.existsSync(worktree), 'worktree directory exists');
    assertEqual(sprint.currentBranch(worktree), 'looparr/task/backend/add-api', 'worktree is on the task branch');
    assertEqual(sprint.currentBranch(repo), 'main', 'live checkout never switched');
    const removed = sprint.removeWorktree(repo, worktree);
    assertOk(removed.ok, `worktree remove succeeds: ${removed.stderr}`);
    assertOk(!fs.existsSync(worktree), 'worktree directory gone');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeTaskBranchesInOrder() {
  const repo = makeTempRepo();
  try {
    const branches = [];
    const files = ['a.txt', 'b.txt', 'c.txt'];
    files.forEach((file, i) => {
      const branch = `looparr/task/backend/task-${i + 1}`;
      const worktree = sprint.taskWorktreePath(repo, 'merge-order-test', i);
      const added = sprint.addTaskWorktree(repo, worktree, branch, 'main');
      assertOk(added.ok, `worktree for ${file}: ${added.stderr}`);
      branches.push({ branch, worktree });
    });
    // Different files in different branches: no conflicts, merge in list order.
    branches.forEach(({ worktree }, i) => {
      fs.writeFileSync(path.join(worktree, files[i]), `content ${i}\n`);
      // Worktrees have their own checkout; run git inside each worktree.
      spawnSync('git', ['-C', worktree, 'add', files[i]], { encoding: 'utf8' });
      spawnSync('git', ['-C', worktree, 'commit', '-m', `task ${i}`], { encoding: 'utf8' });
    });
    const sprintWorktree = sprint.sprintWorktreePath(repo, 'merge-order-test');
    const ensured = sprint.ensureSprintWorktree(repo, sprintWorktree, 'looparr/sprint/backend', 'main');
    assertOk(ensured.ok, `sprint worktree ensured: ${ensured.stderr}`);
    const merged = sprint.mergeTaskBranches(sprintWorktree, branches.map((b) => b.branch));
    assertOk(merged.ok, `merges succeed: ${merged.error} ${merged.output}`);
    assertEqual(merged.merged.length, 3, 'all three branches merged');
    assertEqual(merged.merged[0], 'looparr/task/backend/task-1', 'merge order follows given order');
    for (const file of files) {
      assertOk(fs.existsSync(path.join(sprintWorktree, file)), `${file} present on sprint branch`);
    }
    assertOk(sprint.branchExists(repo, 'looparr/sprint/backend'), 'sprint branch exists');
    assert.equal(git(sprintWorktree, ['log', '--format=%s']).trim().split('\n')[0], 'looparr: merge looparr/task/backend/task-3', 'most recent merge is last branch');
    // Cleanup worktrees before nuking the repo dir.
    for (const path_ of [sprintWorktree, ...branches.map((b) => b.worktree)]) {
      sprint.removeWorktree(repo, path_);
    }
    // Re-creating the sprint worktree must reuse the existing branch, not try
    // to cut it again with -b (manual merge retry / validation restart path).
    const reused = sprint.ensureSprintWorktree(repo, sprintWorktree, 'looparr/sprint/backend', 'main');
    assertOk(reused.ok, 'sprint worktree reuses an existing branch');
    sprint.removeWorktree(repo, sprintWorktree);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeStopsAtConflict() {
  const repo = makeTempRepo();
  try {
    const spin = (branch, worktree, file, text) => {
      const added = sprint.addTaskWorktree(repo, worktree, branch, 'main');
      assertOk(added.ok, `worktree for ${file}: ${added.stderr}`);
      fs.writeFileSync(path.join(worktree, file), text);
      spawnSync('git', ['-C', worktree, 'add', '.'], { encoding: 'utf8' });
      spawnSync('git', ['-C', worktree, 'commit', '-m', `edit ${file}`], { encoding: 'utf8' });
    };
    spin('looparr/task/backend/one', sprint.taskWorktreePath(repo, 'conflict-test', 0), 'shared.txt', 'from one\n');
    spin('looparr/task/backend/two', sprint.taskWorktreePath(repo, 'conflict-test', 1), 'shared.txt', 'from two\n');
    const sprintWorktree = sprint.sprintWorktreePath(repo, 'conflict-test');
    const ensured = sprint.ensureSprintWorktree(repo, sprintWorktree, 'looparr/sprint/conflict', 'main');
    assertOk(ensured.ok, `sprint worktree: ${ensured.stderr}`);
    const merged = sprint.mergeTaskBranches(sprintWorktree, ['looparr/task/backend/one', 'looparr/task/backend/two']);
    assertOk(!merged.ok, 'conflicting merge reported as failure');
    assertOk(merged.error.includes('looparr/task/backend/two'), 'error names the conflicting branch');
    assertEqual(merged.merged.length, 1, 'first branch merged before the conflict');
    const status = spawnSync('git', ['-C', sprintWorktree, 'status', '--porcelain'], { encoding: 'utf8' });
    assertOk(!/^(UU|AA)/m.test(status.stdout), `merge aborted, no staged conflict left${status.stdout ? `: ${status.stdout}` : ''}`);
    sprint.removeWorktree(repo, sprintWorktree);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testLooparrOnlyMergeGuard() {
  const repo = makeTempRepo();
  try {
    git(repo, ['branch', 'regular-feature']);
    const worktree = sprint.taskWorktreePath(repo, 'guard-test', 0);
    const added = sprint.addTaskWorktree(repo, worktree, 'looparr/task/backend/guard', 'main');
    assertOk(added.ok, `worktree: ${added.stderr}`);
    assert.throws(
      () => sprint.mergeBranchInWorktree(worktree, 'regular-feature'),
      /Refusing non-looparr branch/,
      'merging a non-looparr branch throws'
    );
    assert.throws(
      () => sprint.mergeTaskBranches(worktree, ['regular-feature']),
      /Refusing non-looparr branch/,
      'mergeTaskBranches refuses non-looparr branches'
    );
    assert.throws(
      () => sprint.mergeIntoMain(repo, repo, 'guard-test', 'regular-feature'),
      /Refusing non-looparr branch/,
      'mergeIntoMain refuses non-looparr branches'
    );
    spawnSync('git', ['-C', worktree, 'add', '.'], { encoding: 'utf8' });
    sprint.removeWorktree(repo, worktree);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeIntoMainRefusalWhenLive() {
  const repo = makeTempRepo();
  try {
    const spin = (branch, worktree) => {
      const added = sprint.addTaskWorktree(repo, worktree, branch, 'main');
      assertOk(added.ok, `worktree for ${branch}: ${added.stderr}`);
      fs.writeFileSync(path.join(worktree, 'f1.txt'), 'x\n');
      spawnSync('git', ['-C', worktree, 'add', '.'], { encoding: 'utf8' });
      spawnSync('git', ['-C', worktree, 'commit', '-m', `commit ${branch}`], { encoding: 'utf8' });
    };
    spin('looparr/task/backend/f1', sprint.taskWorktreePath(repo, 'main-test', 0));
    // Live checkout is on main: mergeIntoMain must refuse instead of switching it.
    const refused = sprint.mergeIntoMain(repo, repo, 'main-test', 'looparr/task/backend/f1');
    assertOk(!refused.ok, 'merge refused while main is the live checkout branch');
    assertOk(refused.output.includes('git merge --no-ff'), 'refusal carries a manual instruction');
    assertEqual(sprint.currentBranch(repo), 'main', 'live checkout still on main');
    // Switch the live checkout away from main, then the merge goes through a side worktree.
    git(repo, ['checkout', '-b', 'looparr/sprint/side']);
    git(repo, ['checkout', 'main']);
    git(repo, ['checkout', '-B', 'wip-live']);
    const ok = sprint.mergeIntoMain(repo, repo, 'main-test', 'looparr/task/backend/f1');
    assertOk(ok.ok, `merge to main succeeds from side worktree: ${ok.output}`);
    assertEqual(ok.main, 'main', 'main branch reported');
    assertOk(fs.existsSync(path.join(ok.worktree, 'f1.txt')), 'merged file landed in the main worktree');
    assertEqual(git(ok.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main', 'side worktree is on main');
    git(repo, ['worktree', 'remove', ok.worktree]);
    git(repo, ['checkout', 'main']);
    git(repo, ['branch', '-D', 'wip-live', 'looparr/sprint/side']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testRunSprintValidationPassAndFail() {
  const repo = makeTempRepo();
  try {
    const pass = sprint.runSprintValidation(repo, 'exit 0');
    assertOk(pass.ok, 'validation passes on exit 0');
    assertEqual(pass.command, 'exit 0', 'command echoed');
    const fail = sprint.runSprintValidation(repo, 'echo boom; exit 3');
    assertOk(!fail.ok, 'validation fails on nonzero exit');
    assertEqual(fail.exitCode, 3, 'exit code reported');
    assertOk(fail.output.includes('boom'), 'test output returned for redaction');
    const fallback = sprint.runSprintValidation(repo, '   ');
    assertEqual(fallback.command, 'npm test', 'empty command falls back to npm test');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

run('branch naming and looparr guards', testBranchNamingAndGuards);
run('branchForTask collision suffixes', testBranchForTaskCollision);
run('worktree add/remove', testWorktreeAddAndRemove);
run('mergeTaskBranches ordering', testMergeTaskBranchesInOrder);
run('merge stops at conflict', testMergeStopsAtConflict);
run('looparr-only merge guard', testLooparrOnlyMergeGuard);
run('mergeIntoMain refusal + side worktree', testMergeIntoMainRefusalWhenLive);
run('validation run pass/fail', testRunSprintValidationPassAndFail);

console.log(`test-sprint-branches: ${pass} groups passed`);
