'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const engine = require(`${REPO_ROOT}/src/engine`);
const planLib = require(`${REPO_ROOT}/src/plan`);
const sprintLib = require(`${REPO_ROOT}/src/sprint`);
const configStore = require(`${REPO_ROOT}/src/config`);

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

function makeProject(overrides = {}) {
  return { id: 'proj-sched', path: os.tmpdir(), ...overrides };
}

function makeRt(overrides = {}) {
  return { stepTask: null, sprintRuns: [], sprintPending: [], ...overrides };
}

function makePlan(planText) {
  const tasks = planLib.parseTasks(planText);
  const deps = planLib.analyzeDependencies(tasks);
  const firstUnchecked = tasks.find((task) => !task.checked) || null;
  return { ok: true, tasks, next: firstUnchecked, dependencyStatus: deps };
}

function testSprintSettingsDefaults() {
  const settings = engine.sprintSettingsFor(makeProject());
  assertEqual(settings.mode, 'off', 'sprintMode defaults to off');
  assertEqual(settings.sprintsParallel, false, 'sprintsParallel defaults to false');
  assert.deepEqual(settings.sprints, [], 'sprints default to empty');
  assertEqual(settings.testCommand, 'npm test', 'sprintTestCommand defaults to npm test');
  assertEqual(settings.deployMain, false, 'sprintDeployMain defaults to false');
  const explicit = engine.sprintSettingsFor(makeProject({
    sprintMode: '  PARALLEL ',
    sprintsParallel: true,
    sprints: [{ name: 'Backend' }, { name: 'Frontend' }],
    sprintTestCommand: 'npm run check',
    sprintDeployMain: true
  }));
  assertEqual(explicit.mode, 'parallel', 'sprintMode normalization accepts trimmed any-case values');
  assertOk(explicit.sprints.length === 2 && explicit.sprints[0].id === 'backend' && explicit.sprints[1].id === 'frontend', `sprints normalized with ids: ${JSON.stringify(explicit.sprints)}`);
  assertEqual(explicit.testCommand, 'npm run check', 'test command kept');
  assertEqual(explicit.deployMain, true, 'deployMain kept');
  assertEqual(configStore.normalizedSprintMode('banana'), 'off', 'invalid sprintMode falls back to off');
  assertEqual(configStore.normalizedSprintMode('Serial'), 'serial', 'sprintMode normalization is case-insensitive');
  assertEqual(engine.sprintSettingsFor(makeProject({ sprintsParallel: 'yes' })).sprintsParallel, false, 'truthy strings do not enable sprintsParallel');
  assert.ok(configStore.SPRINT_MODES.includes('serial') && configStore.SPRINT_MODES.includes('parallel'), 'SPRINT_MODES has serial and parallel');
}

function testModeOffKeepsLinearNext() {
  const plan = makePlan('- [ ] A [sprint:backend]\n- [ ] B [sprint:backend]');
  const candidate = engine.chooseSprintCandidate(plan, makeProject({ sprintMode: 'off' }), makeRt());
  assertEqual(candidate, plan.next, 'mode off falls back to linear plan.next');
}

function testSerialModeOneTaskPerSprint() {
  const plan = makePlan(
    '- [ ] B1 [sprint:backend]\n- [ ] B2 [sprint:backend]\n- [ ] F1 [sprint:frontend]'
  );
  const rt = makeRt();
  const settingsProject = makeProject({ sprintMode: 'serial' });
  const candidate = engine.chooseSprintCandidate(plan, settingsProject, rt);
  assertEqual(candidate.text, 'B1', 'serial mode picks the first unchecked task of its sprint');
  plan.tasks[0].checked = true;
  const afterFirst = engine.chooseSprintCandidate(plan, settingsProject, rt);
  assertEqual(afterFirst.text, 'B2', 'second backend task becomes eligible after the first');
}

function testParallelModeOffersAllReadyTasks() {
  const plan = makePlan(
    '- [ ] B1 [sprint:backend]\n- [ ] B2 [sprint:backend]\n- [ ] F1 [sprint:frontend]'
  );
  const project = makeProject({ sprintMode: 'parallel' });
  assertEqual(engine.chooseSprintCandidate(plan, project, makeRt()).text, 'B1', 'first ready task');
  plan.tasks[0].checked = true;
  assertEqual(engine.chooseSprintCandidate(plan, project, makeRt()).text, 'B2', 'next ready task chosen even in the same sprint');
  plan.tasks[1].checked = true;
  assertEqual(engine.chooseSprintCandidate(plan, project, makeRt()).text, 'F1', 'frontend task reachable');
}

function testBusyAndFailedRunsSkipped() {
  const plan = makePlan('- [ ] B1 [sprint:backend]\n- [ ] B2 [sprint:backend]');
  const project = makeProject({ sprintMode: 'parallel' });
  const running = makeRt({ sprintRuns: [{ taskIndex: 0, child: {}, status: 'running' }] });
  let candidate = engine.chooseSprintCandidate(plan, project, running);
  assertEqual(candidate.text, 'B2', 'running task is skipped');
  const failed = makeRt({ sprintRuns: [{ taskIndex: 0, child: null, status: 'failed' }] });
  candidate = engine.chooseSprintCandidate(plan, project, failed);
  assertEqual(candidate.text, 'B2', 'failed task is skipped (stays failed for review)');
  const queued = makeRt({ sprintPending: [{ taskIndex: 0, status: 'pending' }] });
  candidate = engine.chooseSprintCandidate(plan, project, queued);
  assertEqual(candidate.text, 'B2', 'pending sprint run is skipped');
}

function testValidationTaskDeferredAndDue() {
  const plan = makePlan(
    '- [ ] B1 [sprint:backend]\n- [ ] B2 [sprint:backend]\n- [ ] (validation: Sprint) [Sprint] Validation [sprint:backend]'
  );
  const project = makeProject({ sprintMode: 'parallel' });
  const rt = makeRt();
  let candidate = engine.chooseSprintCandidate(plan, project, rt);
  assertEqual(candidate.text, 'B1', 'validation task never chosen directly; work tasks first');
  const due = engine.expectSprintValidation(plan, project, rt);
  assert.deepEqual(due, [], 'validation not due while sprint tasks are open');
  plan.tasks[0].checked = true;
  plan.tasks[1].checked = true;
  assert.deepEqual(engine.chooseSprintCandidate(plan, project, rt), null, 'only the validation task remains — nothing to schedule');
  const dueNow = engine.expectSprintValidation(plan, project, rt);
  assertEqual(dueNow.length, 1, 'validation due once all other sprint tasks are checked');
  assertEqual(dueNow[0].sprint, 'backend', 'due entry names the sprint');
  assertEqual(dueNow[0].validationType, 'Sprint', 'due entry names the type');
  assertEqual(dueNow[0].taskIndex, 2, 'due entry points at the validation task index');
}

function testSprintsParallelAndOffModes() {
  const plan = makePlan(
    '- [ ] B1 [sprint:backend]\n- [ ] F1 [sprint:frontend]\n- [ ] (validation: Backend) [Backend] Validation [sprint:backend]'
  );
  const project = makeProject({ sprintMode: 'parallel', sprintsParallel: true });
  assertEqual(engine.chooseSprintCandidate(plan, project, makeRt()).text, 'B1', 'parallel sprints start backend first ready task');
  plan.tasks[0].checked = true;
  assertEqual(engine.chooseSprintCandidate(plan, project, makeRt()).text, 'F1', 'frontend sprint runs alongside (sprintsParallel)');
  const offProject = makeProject({ sprintMode: 'off' });
  assertEqual(engine.chooseSprintCandidate(plan, offProject, makeRt()), plan.next, 'off mode ignores validation deferral too');
  const due = engine.expectSprintValidation(plan, offProject, makeRt());
  assert.deepEqual(due, [], 'no validation round in off mode');
}

function testSprintsParallelFalseKeepsOneSprint() {
  const plan = makePlan(
    '- [ ] B1 [sprint:backend] (depends: 99)\n- [ ] F1 [sprint:frontend]'
  );
  const single = makeProject({ sprintMode: 'parallel', sprintsParallel: false });
  assertEqual(engine.chooseSprintCandidate(plan, single, makeRt()), null, 'a blocked first sprint does not leak into the next sprint');
  const both = makeProject({ sprintMode: 'parallel', sprintsParallel: true });
  assertEqual(engine.chooseSprintCandidate(plan, both, makeRt()).text, 'F1', 'sprintsParallel lets the next sprint advance');
}

function testDependencyBlockedSkipped() {
  const project = makeProject({ sprintMode: 'parallel' });
  const rt = makeRt();
  // B2 depends on a missing task #99: blocked, never scheduled.
  let plan = makePlan('- [ ] B1 [sprint:backend]\n- [ ] B2 [sprint:backend] (depends: 99)');
  assertEqual(engine.chooseSprintCandidate(plan, project, rt).text, 'B1', 'dependency-free task first');
  plan.tasks[0].checked = true;
  assertEqual(engine.chooseSprintCandidate(plan, project, rt), null, 'blocked dependent task is not scheduled');
  // Fixing the dependency onto the checked B1 unblocks B2.
  plan = makePlan('- [ ] B1 [sprint:backend]\n- [ ] B2 [sprint:backend] (depends: 1)');
  plan.tasks[0].checked = true;
  plan.dependencyStatus = { tasks: planLib.analyzeDependencies(plan.tasks).tasks };
  assertEqual(engine.chooseSprintCandidate(plan, project, rt).text, 'B2', 'satisfied dependency unblocks the task');
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-sprint-sched-'));
  const run = (args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Looparr Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  run(['add', 'README.md']);
  run(['commit', '-m', 'seed']);
  return dir;
}

// Gray-out (R4): disk truth survives a container restart — a fresh runtime with
// no rt.state at all still marks tasks started when their looparr/task branch
// or sprint worktree directory exists on disk.
function testStartedFromDiskAfterRestart() {
  const repo = makeTempRepo();
  try {
    git(repo, ['branch', 'looparr/task/backend/add-api']);
    const planText = '- [ ] add api [sprint:backend]\n- [ ] untouched task [sprint:frontend]';
    const tasks = planLib.parseTasks(planText);
    const plan = { ok: true, tasks, next: tasks[0], dependencyStatus: planLib.analyzeDependencies(tasks) };
    const project = makeProject({ id: `proj-disk-${Date.now()}`, path: repo, sprintMode: 'parallel' });
    // Fresh runtime: nothing running, nothing queued — a restart simulation.
    let started = engine.startedTaskIndexes(project, plan, makeRt());
    assertOk(started.has(0), 'task with an existing looparr/task branch counts as started after restart');
    assertOk(!started.has(1), 'task without a branch is not started');
    // Sprint worktree directory on disk marks the matching task started too.
    // Fresh project id bypasses the 5s git-state cache, the way a new process would.
    const restartProject = makeProject({ id: `proj-disk-${Date.now()}-r2`, path: repo, sprintMode: 'parallel' });
    const runId = sprintLib.runIdFor(restartProject.id, 'frontend');
    fs.mkdirSync(path.join(repo, '.looparr', 'sprints', runId, 'sprint'), { recursive: true });
    started = engine.startedTaskIndexes(restartProject, plan, makeRt());
    started = engine.startedTaskIndexes(restartProject, plan, makeRt());
    assertOk(started.has(1), 'matching .looparr/sprints run dir marks the task started');
    // Active runtime state also marks tasks started.
    const rt = makeRt({ sprintRuns: [{ taskIndex: 1, child: null, status: 'running' }] });
    fs.rmSync(path.join(repo, '.looparr'), { recursive: true, force: true });
    git(repo, ['branch', '-D', 'looparr/task/backend/add-api']);
    started = engine.startedTaskIndexes(project, plan, rt);
    assertOk(started.has(1), 'sprint run with no child still counts as started');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function testMergeBranchesIncludesCheckedTasks() {
  const repo = makeTempRepo();
  try {
    git(repo, ['branch', 'looparr/task/backend/one']);
    git(repo, ['branch', 'looparr/task/backend/two']);
    const plan = makePlan('- [x] one [sprint:backend]\n- [x] two [sprint:backend]');
    const result = engine.sprintTaskBranchesInOrder(repo, plan, 'backend');
    assertOk(result.ok, `checked sprint tasks still contribute branches: ${result.error}`);
    assert.deepEqual(result.branches, [
      'looparr/task/backend/one',
      'looparr/task/backend/two'
    ], 'task branches merge in task-index order, including checked tasks');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

// Engine source assertions for the lifecycle parts that need a live server:
// worker cap counts sprint children, stop/pause cover them, prompt block and
// validation routing exist.
function testEngineWiringAssertions() {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'engine.js'), 'utf8');
  assertOk(src.includes('sprintRuns: []'), 'ensureRuntime initializes rt.sprintRuns');
  assertOk(src.includes('sprintPending: []'), 'ensureRuntime initializes rt.sprintPending');
  assertOk(src.includes('sprintValidation: null'), 'ensureRuntime initializes rt.sprintValidation');
  const tickStart = src.indexOf('function tick(');
  assertOk(tickStart !== -1, 'tick exists');
  const tick = src.slice(tickStart, src.indexOf('\nfunction ', tickStart + 1));
  const maxWorkersIn = src.indexOf('function maxWorkers()');
  const workersCount = src.slice(maxWorkersIn, maxWorkersIn + 400);
  assertOk(workersCount.includes('maxConcurrent'), 'maxWorkers derives from config maxConcurrent');
  const busyCount = (tick.match(/rt\.sprintRuns/g) || []).length + (src.match(/sprintRuns\.filter\(\(run\) => run\.child\)/g) || []).length;
  assertOk(busyCount >= 3, 'sprint children counted alongside rt.child in the worker cap');
  assertOk(tick.includes('sprintValidation') || tick.includes('pumpSprintWork'), 'tick pumps sprint work and counts the validation round');
  const stopStart = src.indexOf('function stop(');
  const stop = src.slice(stopStart, src.indexOf('\nfunction ', stopStart + 1));
  assertOk(stop.includes('sprintRuns'), 'stop() tears down sprint children');
  const pauseStart = src.indexOf('function pause(');
  const pause = src.slice(pauseStart, src.indexOf('\nfunction ', pauseStart + 1));
  assertOk(pause.includes('sprint') || pause.includes('pauseAfterStep'), 'pause() blocks new sprint children');
  const startStep = src.indexOf('function startStep(');
  const step = src.slice(startStep, src.indexOf('\nfunction ', startStep + 1));
  assertOk(step.includes('sprintPending'), 'startStep routes sprint implement tasks through sprintPending');
  assertOk(step.includes('sprintValidation'), 'startStep does not mix normal steps with a validation round');
  assertOk(src.includes('sprintValidation.child.kill'), 'stop() kills the validation child');
  assertOk(src.includes('sprintTaskBranchesInOrder'), 'end-of-sprint merge helper exists');
  assertOk(step.includes('nextPhase = \'seed\''), 'sprint interception reseeds the phase machine');
  assertOk(src.includes('sprintPromptBlock'), 'sprint prompt block exists for prompt injection');
  assertOk(src.includes('sprintTestCommand') || src.includes('testCommand'), 'validation uses the configured sprint test command');
  assertOk(!/(^|[^-.])\b(git\s+push\b)/.test(src), 'engine never pushes to a remote');
}

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

run('sprint settings defaults + normalization', testSprintSettingsDefaults);
run('mode off keeps linear next', testModeOffKeepsLinearNext);
run('serial mode: one task per sprint', testSerialModeOneTaskPerSprint);
run('parallel mode: all ready tasks', testParallelModeOffersAllReadyTasks);
run('busy/failed/pending runs skipped', testBusyAndFailedRunsSkipped);
run('validation deferred then due', testValidationTaskDeferredAndDue);
run('sprintsParallel vs off modes', testSprintsParallelAndOffModes);
run('sprintsParallel false keeps one sprint', testSprintsParallelFalseKeepsOneSprint);
run('dependency blocked skipped', testDependencyBlockedSkipped);
run('started from disk after restart', testStartedFromDiskAfterRestart);
run('merge branches includes checked tasks', testMergeBranchesIncludesCheckedTasks);
run('engine wiring assertions', testEngineWiringAssertions);

console.log(`test-sprint-scheduling: ${pass} groups passed`);
