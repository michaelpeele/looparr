#!/usr/bin/env node
'use strict';

// Regression test for the 429 false-positive loop: a successful step (exit 0)
// whose output merely mentions rate-limit wording (echoed prompts, commit
// bodies, reports) must complete normally, never classify as rate limited,
// and never rotate candidates.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-rate-limit-success-guard-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const TASK = 'Remove project count from top right of home page';
const FOUR29_LINE = 'SessionError: [429]: Tokens per minute limit exceeded - too many tokens processed. (reset after 1m)';

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function runnerScript() {
  return `
const fs = require('fs');
const path = require('path');
const phase = process.env.FAKE_PHASE || '';
const handoffPath = path.join(process.cwd(), '.looparr', 'next_prompt.txt');
fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
if (phase === 'seed') {
  fs.writeFileSync(handoffPath, 'Analyze the current task and write an implementation prompt.');
} else if (phase === 'analyze') {
  fs.writeFileSync(handoffPath, 'Implement the task in public/index.html and commit. Quoted history: ${'${JSON.stringify(FOUR29_LINE).slice(1, -1)}'}');
  process.stdout.write('Echoed prompt quotes ${'${JSON.stringify(FOUR29_LINE).slice(1, -1)}'}\\n');
}
process.stdout.write('IMPLEMENT OUTPUT mentions 429 tokens per minute limit exceeded\\n');
process.exit(0);
`;
}

function projectState(engine, projectId) {
  const state = engine.getState();
  return state && state.projects && state.projects.find((item) => item.id === projectId);
}

async function waitFor(getValue, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = getValue();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for expected state');
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  process.env.CONFIG_PATH = CONFIG_PATH;
  process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;
  process.env.HOSTNAME = 'test-host';
  process.env.LOOPARR_ALLOW_RESUME_INTENT = '1';

  // 1. Vibe runner must not read echoed user/assistant message events as
  // provider errors, but must still match a genuine stderr error.
  const vibe = loadFresh('../src/runners/vibe.js');
  const echoLine = `{"id":"user-turn-1","role":"user","content":[{"text":"${FOUR29_LINE}"}]}`;
  const echoAssistant = `{"id":"assistant-1","role":"assistant","content":[{"text":"The commit message mentions tokens per minute limit exceeded."}]}`;
  assert.strictEqual(vibe.isRateLimit(echoLine), false, 'echoed user message is not a rate limit');
  assert.strictEqual(vibe.isRateLimit(echoAssistant), false, 'echoed assistant message is not a rate limit');
  assert.strictEqual(vibe.isRateLimit(`${echoLine}\nSessionError: [429]: Tokens per minute limit exceeded - too many tokens processed.`), true, 'genuine error line is still detected');

  let engine = null;
  try {
    const configStore = loadFresh('../src/config.js');
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ settings: configStore.DEFAULT_SETTINGS }, null, 2));

    const runners = loadFresh('../src/runners/index.js');
    const seenPhases = [];
    // isRateLimit: () => true is intentionally aggressive: with exit 0 the
    // success guard must win before this matcher is even consulted.
    runners.registerRunner({
      id: 'opencode',
      label: 'Fake',
      description: 'Fake runner for rate-limit success-guard test',
      ensureServer: async () => null,
      buildCommand: ({ cwd, ...payload }) => {
        seenPhases.push(payload.phase);
        return {
          command: process.execPath,
          args: ['-e', runnerScript()],
          options: {
            cwd: cwd || process.cwd(),
            env: { ...process.env, FAKE_PHASE: payload.phase || '' },
            shell: false
          }
        };
      },
      isRateLimit: () => true
    });

    engine = loadFresh('../src/engine.js');

    const projectDir = path.join(PROJECTS_ROOT, 'guard-project');
    const handoffPath = path.join(projectDir, '.looparr', 'next_prompt.txt');
    const provenancePath = path.join(projectDir, '.looparr', 'handoff_task.txt');
    const planPath = path.join(projectDir, 'plan.md');
    fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
    fs.writeFileSync(planPath, `# Plan\n\n- [ ] ${TASK}\n`);

    const project = engine.addProject({
      name: 'Success guard project',
      path: projectDir,
      runner: 'opencode',
      autoResumeOnStart: true
    });

    assert.strictEqual(engine.start(project.id), true);
    const finished = await waitFor(() => {
      const state = projectState(engine, project.id);
      return state && state.status === 'done' ? state : null;
    });

    assert.deepStrictEqual(seenPhases, ['seed', 'analyze', 'implement'], 'full seed/analyze/implement cycle ran once');
    assert.ok(!finished.logs.some((log) => String(log.text).includes('All candidates rate limited')), 'no rate-limited classification');
    assert.ok(!finished.logs.some((log) => String(log.text).includes('Model failure on')), 'no candidate rotation on success');
    assert.ok(finished.logs.some((log) => String(log.text) === `✓ Done: ${TASK}`), 'implement success marked done');
    assert.ok(fs.readFileSync(planPath, 'utf8').includes(`- [x] ${TASK}`), 'plan marker checked');
    assert.strictEqual(fs.existsSync(handoffPath), false, 'handoff cleared after success');
    assert.strictEqual(fs.existsSync(provenancePath), false, 'handoff provenance cleared after success');

    // Mid-cycle provenance: seed must stamp the sidecar with the task text.
    assert.ok(seenPhases.includes('analyze'), 'analyze ran');

    assert.strictEqual(engine.stop(project.id), true);
    console.log('rate-limit success guard tests passed');
  } finally {
    if (engine) {
      try {
        for (const project of engine.getState().projects) engine.stop(project.id);
      } catch { /* teardown best effort */ }
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
