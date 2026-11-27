'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const configStore = require(path.join(REPO_ROOT, 'src/config.js'));
const autoResume = require(path.join(REPO_ROOT, 'src/auto-resume.js'));

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

function assertAbsent(text, fragment, label) {
  assert.ok(!text.includes(fragment), `${label}: must not contain ${JSON.stringify(fragment)}`);
}

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function testConfig() {
  assertEqual(configStore.DEFAULT_SETTINGS.selfHealing, false, 'selfHealing defaults off');
  assertEqual(configStore.normalizeSettings({}).selfHealing, false, 'fresh settings normalize off');
  assertEqual(configStore.normalizeSettings({ selfHealing: true }).selfHealing, true, 'true is preserved');
  assertEqual(configStore.normalizeSettings({ selfHealing: 'yes' }).selfHealing, false, 'non-boolean normalizes off');
}

function testSnapshot() {
  const snapshot = autoResume.sanitizeSnapshot({
    healer: {
      state: 'healed',
      round: 1,
      cycles: 2,
      branch: 'looparr-selfheal-1',
      worktree: '/tmp/worktree',
      phase: 'implement',
      errorAt: '2026-11-24T00:00:00.000Z',
      mergedAt: '',
      secret: 'must not survive'
    }
  });
  assert.ok(snapshot && snapshot.healer, 'healer snapshot survives sanitization');
  assertEqual(snapshot.healer.state, 'healed', 'healer state persisted');
  assertEqual(snapshot.healer.cycles, 2, 'healer cycles persisted');
  assertEqual(snapshot.healer.branch, 'looparr-selfheal-1', 'healer branch persisted');
  assertEqual(snapshot.healer.worktree, '/tmp/worktree', 'healer worktree persisted');
  assert.ok(!('secret' in snapshot.healer), 'unknown healer keys dropped');
  assertEqual(autoResume.sanitizeSnapshot({ healer: ['not', 'an', 'object'] }), undefined, 'array healer ignored');
}

function testEngine() {
  const engine = read('src/engine.js');
  assertIncludes(engine, 'function selfHealingEnabled()', 'engine dev gate helper');
  assertIncludes(engine, "process.env.NODE_ENV === 'production'", 'prod hard stop');
  const killSwitchAt = engine.indexOf("process.env.LOOPARR_SELFHEAL === '0'");
  const overrideAt = engine.indexOf("process.env.LOOPARR_SELFHEAL === '1'");
  const prodStopAt = engine.indexOf("process.env.NODE_ENV === 'production'");
  assert.ok(killSwitchAt !== -1, 'explicit LOOPARR_SELFHEAL=0 kill switch present');
  assert.ok(overrideAt !== -1, 'explicit LOOPARR_SELFHEAL=1 signal present');
  assert.ok(killSwitchAt < overrideAt && overrideAt < prodStopAt,
    'gate precedence: kill switch, then override, then the production block');
  assertIncludes(engine, "SELFHEAL_MARKER = 'SELFHEAL_ENABLED'", 'dev marker file constant');
  assertIncludes(engine, "'NODE_ENV=production without LOOPARR_SELFHEAL=1'",
    'disabled reason names the production stop');
  assertIncludes(engine, "no dev signal (LOOPARR_SELFHEAL=1 or a ${SELFHEAL_MARKER} file)",
    'disabled reason names the missing dev signal');
  assertIncludes(engine, 'function selfHealDisabledReason', 'disabled-reason helper');
  assertIncludes(engine, 'Self-heal is enabled but unavailable in this process',
    'non-prod guard logs why no round started');
  assertIncludes(engine, 'the host standby self-heal daemon owns the round',
    'prod guard delegates the round to the standby daemon');
  assertIncludes(engine, 'no in-process round is needed',
    'prod guard says no in-process round is needed');
  assertIncludes(engine, "reason.startsWith('NODE_ENV=production')",
    'delegation stays limited to the production reason');
  assertIncludes(engine, "config.settings.selfHealing === true && reason",
    'guard log only fires while the setting is on');
  assertIncludes(engine, 'HEALER_MAX_ROUNDS = 1', 'one-round cap constant');
  assertIncludes(engine, "failedPhase === HEALER_PHASE", 'healer never recurses');
  assertIncludes(engine, 'rt.healerLastExitAt && Date.now() - rt.healerLastExitAt < HEALER_COOLDOWN_MS', 'cooldown gate');
  assertIncludes(engine, "'worktree', 'add', '-b', branch, worktree, 'HEAD'", 'worktree isolation');
  assertIncludes(engine, "path.join(repoRoot, '.looparr', 'selfheal', runId)", 'worktree lives under .looparr');
  assertIncludes(engine, 'HEALER_CYCLES_REQUIRED = 2', 'two-cycle validation');
  for (const event of ['healer-spawned', 'healer-exit', 'healer-healed', 'healer-failed', 'healer-spundown']) {
    assertIncludes(engine, event, `audit event ${event}`);
  }
  assertIncludes(engine, 'snapshot.healer', 'healer persisted in resume snapshot');
  assertIncludes(engine, "'merge', '--no-ff'", 'merge runs locally');
  assertIncludes(engine, 'mergeHealerBranch', 'healer merge entry point');
  assertIncludes(engine, "'merge-base', '--is-ancestor'", 'already-ancestor idempotent merge path');
  assertIncludes(engine, 'validateMergeRequest(selfhealRepoRoot()', 'status-file fallback when no in-memory healer');
  assertIncludes(engine, 'reconcileStaleHealedStatuses(selfhealRepoRoot()', 'heartbeat retires stale healed statuses');
  assertIncludes(engine, 'isMergeableBranch(repoRoot, branch)', 'merge rechecks branch mergeability before merging');
  assertIncludes(engine, 'function healerAnalysis(', 'end-of-round analysis writeup');
  assertIncludes(engine, '-analysis.md', 'analysis filename');
  assertIncludes(engine, 'function finishHealerRound(', 'end-of-round teardown');
  assertIncludes(engine, 'healer.exitCode = code', 'healer exit code recorded');
  assertIncludes(engine, 'finishHealerRound(project, healer, \'healed\'', 'analysis on healed rounds');
  assertIncludes(engine, 'function isMergeableHealer(', 'mergeable healer guard');
  assertIncludes(engine, 'rt.lastHealer = isMergeableHealer(healer) ? healer : null', 'failed rounds are not parked');
  assertIncludes(engine, 'isMergeableHealer(parked)', 'parked healer view is gated');
  assertIncludes(engine, 'isMergeableHealer(snap.lastHealer)', 'restored healer view is gated');
  assertAbsent(engine, "'push'", 'engine never publishes git');
  assertAbsent(engine, '"push"', 'engine never publishes git (double quotes)');
  assert.ok(!/'git',\s*'push'/.test(engine), 'engine has no git publish call');

  const server = read('server.js');
  assertIncludes(server, "'/api/projects/:id/selfheal/merge'", 'merge route');
  assertAbsent(server, "'push'", 'server never publishes git');
}

function testUi() {
  const html = read('public/index.html');
  const app = read('public/app.js');
  const css = read('public/styles.css');
  assertIncludes(html, 'id="self-heal-pill"', 'header pill');
  assertIncludes(html, 'data-state="idle"', 'idle pill default');
  assertIncludes(html, 'id="self-heal-state"', 'pill state text');
  assertIncludes(html, 'id="self-heal-branch"', 'git-branch button');
  assertIncludes(html, 'id="self-healing-toggle"', 'settings toggle');
  assertIncludes(app, 'function renderSelfHealing', 'pill renderer');
  assertIncludes(app, 'selfHealingAvailable', 'availability gate');
  assertIncludes(app, 'dom.selfHealBranch.hidden = !showHeader', 'header merge button only for exactly-one-healed');
  assertIncludes(app, 'healedUnmerged.length === 1', 'header button gated to single healed project');
  assertIncludes(app, 'self-heal-merge', 'per-card merge button class');
  assertIncludes(app, "healer.state === 'healed'\n    && !healer.mergedAt", 'merge gate requires healed and unmerged');
  assertIncludes(app, '/^looparr-selfheal-\\d+-\\d+$/.test(healer.branch', 'merge gate requires a real healer branch');
  assertIncludes(app, 'healer.mergeable !== false', 'merge gate requires the host mergeable flag');
  assertIncludes(app, 'engaged.filter(isMergeReadyHealer)', 'header gate uses the shared merge-ready check');
  assertIncludes(app, 'const showMerge = isMergeReadyHealer(healer)', 'per-card gate uses the shared merge-ready check');
  assertIncludes(app, 'mergeSelfHealBranch(mergeButton)', 'per-card merge wired to its own button');
  assertIncludes(app, 'Test complete on', 'merge confirmation');
  assertIncludes(app, 'Merge to main and rebuild/restart?', 'human-gated merge copy');
  assertIncludes(app, 'Nothing is published', 'merge never publishes');
  assertIncludes(app, 'selfHealing: dom.selfHealing.checked', 'settings save body');
  assertIncludes(app, '/selfheal/merge', 'merge endpoint call');
  assertIncludes(css, '.self-heal-pill', 'pill css');
  assertIncludes(html, 'class="self-heal-bug"', 'pixel bug sprite in the header');
  assertIncludes(css, '.self-heal-bug * { fill: currentColor; }', 'bug sprite takes the state colour');
  assertIncludes(css, 'color: #94a3b8', 'idle bug stays visible');
  assertIncludes(css, 'color: #06222b', 'bug is dark on the lit cyan light');
  for (const state of ['debugging', 'healing', 'healed', 'error']) {
    assertIncludes(css, `[data-state="${state}"]`, `pill state ${state}`);
  }
  assertIncludes(css, 'linear-gradient(90deg, var(--accent), var(--accent-2), var(--green))', 'engaged gradient');
  assertIncludes(css, 'var(--green)', 'healed green dot');
  assertIncludes(app, 'function setSettingsStatus(message, isError = false)', 'shared settings status writer');
  assertIncludes(app, "classList.toggle('error', !!isError)", 'settings status error class');
  assertIncludes(app, 'function confirmMergeCompleted(button, branch)', 'merge completion verification');
  assertIncludes(app, "fetch('/api/state'", 'merge verification reads state');
  assertIncludes(app, 'healer.mergedAt', 'merge verification checks merged state');
  assertIncludes(app, 'could not confirm', 'clear merge failure copy');
  assertAbsent(app, 'merge submitted for', 'no false success on dropped merge');
  assertIncludes(css, '#settings-status.error { color: var(--red); }', 'settings status error styling');
}

function testDocsAndCompose() {
  const compose = read('docker-compose.heal.yml');
  assertIncludes(compose, 'name: looparr-heal', 'separate preview project');
  assertIncludes(compose, 'LOOPARR_HEAL_PORT', 'preview port override');
  assertIncludes(compose, 'NODE_ENV: production', 'preview stays production-gated');
  assertIncludes(compose, 'LOOPARR_SELFHEAL: "0"', 'preview self-heal off');

  const docs = read('SELFHEALING.md');
  assertIncludes(docs, 'worktree', 'docs cover isolation');
  assertIncludes(docs, 'Threat model', 'docs cover threat model');
  assert.ok(/human review/i.test(docs), 'docs state the human-review rule');
  assert.ok(/never .*publish|nothing is pushed/i.test(docs), 'docs promise no publish');
}

testConfig();
testSnapshot();
testEngine();
testUi();
testDocsAndCompose();
console.log('self-heal guards passed');
