'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-plan-ui-controls-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const DEMO_DIR = path.join(PROJECTS_ROOT, 'demo');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const PLAN_PATH = path.join(DEMO_DIR, 'plan.md');
const BASE_URL = 'http://127.0.0.1:4201';

process.env.PORT = '4201';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

let server = null;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

async function api(method, route, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${route}`, options);
  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON responses as text for diagnostics.
  }
  return { status: response.status, body: payload };
}

async function fetchAsset(route, label) {
  const response = await fetch(`${BASE_URL}${route}`);
  assertEqual(response.status, 200, `${label} status`);
  return response.text();
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/state`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${lastError && lastError.message}`);
}

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `Missing function: ${signature}`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart >= 0, `Missing function body: ${signature}`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unbalanced function body: ${signature}`);
}

function loadReorderFunctions() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const regexMatch = source.match(/^\s*const TASK_LINE_RE = .*;$/m);
  assert.ok(regexMatch, 'Missing TASK_LINE_RE');
  const indexes = extractFunction(source, 'function planTaskLineIndexes(content)');
  const reorder = extractFunction(source, 'function reorderPlanTask(content, fromTaskIndex, toTaskIndex)');
  const factory = new Function(`${regexMatch[0]}\n${indexes}\n${reorder}\nreturn { planTaskLineIndexes, reorderPlanTask };`);
  return factory();
}

function loadTaskActionFunctions() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const lineRegex = source.match(/^\s*const TASK_LINE_RE = .*;$/m);
  const editRegex = source.match(/^\s*const TASK_EDIT_RE = .*;$/m);
  assert.ok(lineRegex, 'Missing TASK_LINE_RE');
  assert.ok(editRegex, 'Missing TASK_EDIT_RE');
  const indexes = extractFunction(source, 'function planTaskLineIndexes(content)');
  const target = extractFunction(source, 'function taskEditTarget(content, taskIndex)');
  const normalize = extractFunction(source, 'function normalizeTaskEditText(text)');
  const edit = extractFunction(source, 'function editPlanTaskContent(content, taskIndex, newText)');
  const remove = extractFunction(source, 'function removePlanTaskContent(content, taskIndex)');
  const factory = new Function([
    lineRegex[0],
    editRegex[0],
    indexes,
    target,
    normalize,
    edit,
    remove,
    'return { editPlanTaskContent, removePlanTaskContent };'
  ].join('\n'));
  return factory();
}

function assertServedAssets(indexHtml, appSource, cssSource) {
  assertIncludes(indexHtml, 'id="toggle-completed-tasks"', 'index toggle id');
  assertIncludes(indexHtml, 'data-action="toggle-completed"', 'index toggle action');
  assertIncludes(indexHtml, 'type="button"', 'index toggle type');
  assertIncludes(indexHtml, 'Hide completed', 'index toggle label');
  assertIncludes(indexHtml, '⊟', 'index toggle icon');

  assertIncludes(appSource, 'toggleCompletedTasks: $(\'toggle-completed-tasks\')', 'app toggle dom binding');
  assertIncludes(appSource, 'showCompleted: true', 'app showCompleted state');
  assertIncludes(appSource, 'data-task-index="${taskIndex}"', 'app full task index');
  assertIncludes(appSource, 'data-index="${task.index}"', 'app API checkbox index');
  assertIncludes(appSource, 'data-action="drag"', 'app drag action');
  assertIncludes(appSource, 'Drag to reorder task', 'app drag label');
  assertIncludes(appSource, '☰', 'app drag icon');
  assertIncludes(appSource, 'data-action="move-top"', 'app move-top action');
  assertIncludes(appSource, 'data-action="move-bottom"', 'app move-bottom action');
  assertIncludes(appSource, '⇈', 'app move-top icon');
  assertIncludes(appSource, '⇊', 'app move-bottom icon');
  assertIncludes(appSource, 'No incomplete tasks. Show completed to edit.', 'app empty state');
  assertIncludes(appSource, 'updatePlanControls()', 'app control updates');
  assertIncludes(appSource, 'Save plan.md first', 'app dirty status');
  assertIncludes(appSource, 'reorderPlanTask(content, fromTaskIndex, toTaskIndex)', 'app raw reorder helper');
  assertIncludes(appSource, 'reorderChecklistTask(fromTaskIndex, toTaskIndex)', 'app checklist reorder helper');
  assertIncludes(appSource, 'planSaveChain', 'app serialized saves');
  assertIncludes(appSource, 'setPointerCapture', 'app pointer capture');
  assertIncludes(appSource, 'pointerdown', 'app pointerdown listener');
  assertIncludes(appSource, 'pointermove', 'app pointermove listener');
  assertIncludes(appSource, 'pointerup', 'app pointerup listener');
  assertIncludes(appSource, 'pointercancel', 'app pointercancel listener');
  assertIncludes(appSource, 'elementFromPoint', 'app drop target');
  assertIncludes(appSource, 'drag-before', 'app insertion indicator before');
  assertIncludes(appSource, 'drag-after', 'app insertion indicator after');
  assertIncludes(appSource, "if (action === 'drag') return;", 'app drag click guard');
  assertIncludes(appSource, 'refreshState()', 'app state refresh after save');
  assertIncludes(appSource, 'editingTaskIndex', 'app edit mode state');
  assertIncludes(appSource, 'editPlanTaskContent', 'app edit content helper');
  assertIncludes(appSource, 'removePlanTaskContent', 'app remove content helper');
  assertIncludes(appSource, 'data-action="edit-task"', 'app edit task action');
  assertIncludes(appSource, 'data-action="save-task"', 'app save task action');
  assertIncludes(appSource, 'data-action="remove-task"', 'app remove task action');
  assertIncludes(appSource, 'class="task-actions"', 'app task action group');
  assertIncludes(appSource, 'save-task-button', 'app save task button class');
  assertIncludes(appSource, 'remove-task-button', 'app remove task button class');
  assertIncludes(appSource, 'task-edit-input', 'app edit input class');
  assertIncludes(appSource, '✎', 'app edit pencil icon');
  assertIncludes(appSource, '💾', 'app save floppy icon');
  assertIncludes(appSource, '✕', 'app delete x icon');
  assertIncludes(appSource, 'aria-label="Delete task"', 'app delete aria label');
  assertIncludes(appSource, 'title="Edit task"', 'app edit title');
  assertIncludes(appSource, 'title="Save task"', 'app save title');
  assertIncludes(appSource, 'title="Delete task"', 'app delete title');
  assertIncludes(appSource, 'window.confirm', 'app delete confirmation');
  assertIncludes(appSource, "'Delete task '+(taskIndex+1)+': \"'", 'app confirm copy prefix');
  assertIncludes(appSource, 'This removes the checklist line from plan.md and cannot be undone.', 'app confirm copy');
  assertIncludes(appSource, 'change === undefined ? { content } : { content, change }', 'app optional change payload');
  assertIncludes(appSource, "type: 'edit'", 'app edit change type');
  assertIncludes(appSource, "type: 'remove'", 'app remove change type');

  const toggleSource = extractFunction(appSource, 'function toggleCompleted()');
  assert.ok(!toggleSource.includes('api('), 'toggleCompleted must not call the API');
  assert.ok(!toggleSource.includes('PUT'), 'toggleCompleted must not write plan.md');

  assertIncludes(cssSource, '.plan-actions', 'css plan actions');
  assertIncludes(cssSource, '.toggle-completed', 'css toggle button');
  assertIncludes(cssSource, '.drag-handle', 'css drag handle');
  assertIncludes(cssSource, 'touch-action: none', 'css handle touch behavior');
  assertIncludes(cssSource, 'cursor: grab', 'css grab cursor');
  assertIncludes(cssSource, '.drag-before', 'css indicator before');
  assertIncludes(cssSource, '.drag-after', 'css indicator after');
  assertIncludes(cssSource, 'body.plan-dragging', 'css dragging body');
  assertIncludes(cssSource, '44px', 'css touch target size');
  assertIncludes(cssSource, '.task-actions', 'css task actions');
  assertIncludes(cssSource, '.edit-task-button', 'css edit button');
  assertIncludes(cssSource, '.save-task-button', 'css save button');
  assertIncludes(cssSource, '.remove-task-button', 'css remove button');
  assertIncludes(cssSource, '.task-edit-input', 'css edit input');
  assertIncludes(cssSource, ':focus-visible', 'css focus outline');

  assertIncludes(indexHtml, 'class="view" data-view', 'index view wrapper');
  assertIncludes(indexHtml, 'data-view="projects"', 'index projects view');
  assertIncludes(indexHtml, 'data-view="settings"', 'index settings view');
  assertIncludes(indexHtml, 'data-view="add"', 'index add view');
  assertIncludes(indexHtml, 'side-emoji', 'index nav emoji icons');
  assertIncludes(indexHtml, 'id="drawer-block-threshold"', 'index drawer threshold override');
  assertIncludes(indexHtml, 'id="drawer-temporary-lift-scope"', 'index drawer temp lift override');
  assertIncludes(indexHtml, 'id="drawer-permanent-lift"', 'index drawer perm lift override');
  assertIncludes(indexHtml, 'id="save-block-policy"', 'index save block policy');

  assertIncludes(appSource, "const VIEWS = ['projects', 'settings', 'add']", 'app view list');
  assertIncludes(appSource, 'function showView(view)', 'app view switcher');
  assertIncludes(appSource, 'side-link[data-view]', 'app nav delegation');
  assertIncludes(appSource, 'drawerBlockThreshold', 'app threshold dom binding');
  assertIncludes(appSource, 'saveBlockPolicy()', 'app block policy save');
  assertIncludes(appSource, 'overrides.blockThreshold ?? \'\'', 'app override display fallback');

  assertIncludes(cssSource, '.view', 'css view container');
  assertIncludes(cssSource, '.side-emoji', 'css nav emoji');
  assertIncludes(cssSource, '.drawer-policy-editor', 'css drawer policy editor');
}

async function testReorderPureFunctions() {
  const { planTaskLineIndexes, reorderPlanTask } = loadReorderFunctions();
  const raw = [
    '# Build plan',
    '',
    '- [x] done',
    '  * [ ] indented',
    'note between tasks',
    '+ [X] Uppercase',
    '',
    '- [ ]',
    'tail',
    ''
  ].join('\r\n');
  const expected = [
    '# Build plan',
    '',
    '- [x] done',
    '+ [X] Uppercase',
    'note between tasks',
    '- [ ]',
    '',
    '  * [ ] indented',
    'tail',
    ''
  ].join('\r\n');

  assert.deepEqual(planTaskLineIndexes(raw), [2, 3, 5, 7], 'task line indexes with CRLF and mixed markers');
  assertEqual(reorderPlanTask(raw, 1, 3), expected, 'reorder preserves non-task lines and CRLF');
  assertEqual(reorderPlanTask(raw, 2, 2), raw, 'same-position reorder is a no-op');
  assertEqual(reorderPlanTask(raw, -1, 2), null, 'invalid source index');
  assertEqual(reorderPlanTask(raw, 0, 4), null, 'invalid target index');
}

async function testTaskActionPureFunctions() {
  const { editPlanTaskContent, removePlanTaskContent } = loadTaskActionFunctions();
  const crlf = [
    '# Plan',
    '',
    '- [x] done',
    '  * [ ] indented',
    'note between lines',
    '+ [X] Upper',
    ''
  ].join('\r\n');
  const edited = editPlanTaskContent(crlf, 1, '  New   text  ');
  assertEqual(edited.ok, true, 'served edit helper ok');
  assertEqual(
    edited.content,
    crlf.replace('  * [ ] indented', '  * [ ] New text'),
    'served edit helper preserves CRLF, indent, marker and check state'
  );
  const removed = removePlanTaskContent(crlf, 1);
  assertEqual(removed.ok, true, 'served remove helper ok');
  assertEqual(
    removed.content,
    crlf.replace('  * [ ] indented\r\n', ''),
    'served remove helper removes only target line'
  );

  const lf = '- [ ] one\n- [x] two\n';
  assertEqual(editPlanTaskContent(lf, 0, 'alpha').content, '- [ ] alpha\n- [x] two\n', 'served edit helper LF');
  assertEqual(removePlanTaskContent(lf, 1).content, '- [ ] one\n', 'served remove helper LF');

  const bullets = '* [ ] star\n+ [X] plus\n- [x] dash\n';
  assertEqual(editPlanTaskContent(bullets, 0, 'a').content, '* [ ] a\n+ [X] plus\n- [x] dash\n', 'served star bullet edit');
  assertEqual(editPlanTaskContent(bullets, 1, 'b').content, '* [ ] star\n+ [X] b\n- [x] dash\n', 'served plus bullet and X edit');
  assertEqual(editPlanTaskContent(bullets, 2, 'c').content, '* [ ] star\n+ [X] plus\n- [x] c\n', 'served dash bullet and x edit');

  for (const index of [-1, 1.5, 99]) {
    assertEqual(editPlanTaskContent(lf, index, 'x').ok, false, `served edit invalid index ${index}`);
    assertEqual(removePlanTaskContent(lf, index).ok, false, `served remove invalid index ${index}`);
  }
  const blank = editPlanTaskContent(lf, 0, '  \n ');
  assertEqual(blank.ok, false, 'served blank edit rejected');
  assertEqual(blank.error, 'Task text is required', 'served blank edit error');

  const duplicate = '- [ ] same\n- [ ] same\n- [ ] other\n';
  assertEqual(removePlanTaskContent(duplicate, 1).content, '- [ ] same\n- [ ] other\n', 'served remove only target duplicate');
}

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 4, mode: 'serial', rateLimitPauseSeconds: 12 },
    projects: []
  }, null, 2));

  const raw = [
    '# Build plan',
    '',
    '- [x] done',
    '  * [ ] indented',
    'note between tasks',
    '+ [X] Uppercase',
    '',
    '- [ ]',
    'tail',
    ''
  ].join('\r\n');
  fs.writeFileSync(PLAN_PATH, raw);

  server = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  try {
    await waitForServer();

    const indexHtml = await fetchAsset('/', 'GET /');
    const appSource = await fetchAsset('/app.js', 'GET /app.js');
    const cssSource = await fetchAsset('/styles.css', 'GET /styles.css');
    assertServedAssets(indexHtml, appSource, cssSource);

    await testReorderPureFunctions();
    await testTaskActionPureFunctions();

    const created = await api('POST', '/api/projects', {
      name: 'demo',
      path: DEMO_DIR,
      runner: 'opencode'
    });
    assertEqual(created.status, 201, 'project create status');
    const projectId = created.body.project.id;

    const route = `/api/projects/${encodeURIComponent(projectId)}/plan`;
    const initial = await api('GET', route);
    assertEqual(initial.status, 200, 'GET plan status');
    assertEqual(initial.body.content, raw, 'GET plan preserves raw CRLF content');
    assertEqual(initial.body.tasks.length, 4, 'GET plan task count');
    assertEqual(initial.body.stats.total, 4, 'GET plan stats total');
    assertEqual(initial.body.tasks[0].checked, true, 'lowercase x is checked');
    assertEqual(initial.body.tasks[2].checked, true, 'uppercase X is checked');
    assertEqual(initial.body.tasks[3].text, '', 'empty task text parses');

    const checked = await api('POST', `/api/projects/${encodeURIComponent(projectId)}/tasks`, {
      index: 1,
      checked: true
    });
    assertEqual(checked.status, 200, 'POST task status');
    const afterCheck = await api('GET', route);
    assertEqual(afterCheck.body.tasks[1].checked, true, 'task index maps to second task');
    const expectedChecked = raw
      .replace('  * [ ] indented', '  * [x] indented')
      .replace(/\r\n/g, '\n');
    assertEqual(
      afterCheck.body.content,
      expectedChecked,
      'task check updates only the targeted line'
    );

    const reordered = reorderPlanTaskForTest(raw, 1, 3);
    const saved = await api('PUT', route, { content: reordered });
    assertEqual(saved.status, 200, 'PUT plan status');
    const afterSave = await api('GET', route);
    assertEqual(afterSave.body.content, reordered, 'PUT plan preserves reordered raw lines');
    assertEqual(afterSave.body.tasks[3].text, 'indented', 'reordered task moves to final position');

    const editedContent = editPlanTaskContentForTest(reordered, 2, 'Edited note');
    const editSaved = await api('PUT', route, {
      content: editedContent,
      change: { type: 'edit', index: 2, oldText: afterSave.body.tasks[2].text, newText: 'Edited note' }
    });
    assertEqual(editSaved.status, 200, 'PUT plan with edit change status');
    const afterEdit = await api('GET', route);
    assertEqual(afterEdit.body.content, editedContent, 'PUT with edit change returns edited content');
    assertEqual(afterEdit.body.tasks[2].text, 'Edited note', 'GET returns edited task text');

    const malformedSaved = await api('PUT', route, {
      content: editedContent,
      change: { type: 'unknown', index: -1 }
    });
    assertEqual(malformedSaved.status, 200, 'PUT ignores malformed change');
    const afterMalformed = await api('GET', route);
    assertEqual(afterMalformed.body.content, editedContent, 'malformed change leaves content intact');

    const removedContent = removePlanTaskContentForTest(editedContent, 2);
    const removeSaved = await api('PUT', route, {
      content: removedContent,
      change: { type: 'remove', index: 2, oldText: 'Edited note' }
    });
    assertEqual(removeSaved.status, 200, 'PUT plan with remove change status');
    const afterRemove = await api('GET', route);
    assertEqual(afterRemove.body.content, removedContent, 'PUT with remove change returns removed content');
    assertEqual(afterRemove.body.tasks.length, 3, 'GET reflects removed task count');
    assertEqual(afterRemove.body.tasks[2].text, 'indented', 'GET returns remaining task after removal');

    const patchBlock = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
      blockThreshold: 5,
      temporaryLiftScope: 'src/engine.js',
      permanentLift: 'public/app.js'
    });
    assertEqual(patchBlock.status, 200, 'block override patch status');
    const afterBlock = await api('GET', '/api/state');
    const updated = afterBlock.body.projects.find((project) => project.id === projectId);
    assertEqual(updated.blockPolicy.overrides.blockThreshold, 5, 'threshold override persisted');
    assertEqual(updated.blockPolicy.overrides.temporaryLiftScope, 'src/engine.js', 'temp lift override persisted');
    assertEqual(updated.blockPolicy.overrides.permanentLift, 'public/app.js', 'perm lift override persisted');
    assertEqual(updated.blockPolicy.blockThreshold, 5, 'effective threshold uses override');

    const clearThreshold = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
      blockThreshold: ''
    });
    assertEqual(clearThreshold.status, 200, 'clear threshold status');
    const afterClear = await api('GET', '/api/state');
    const cleared = afterClear.body.projects.find((project) => project.id === projectId);
    assertEqual(cleared.blockPolicy.overrides.blockThreshold, null, 'threshold override cleared');
    assertEqual(cleared.blockPolicy.blockThreshold, 2, 'cleared threshold inherits global default');

    const badThreshold = await api('PATCH', `/api/projects/${encodeURIComponent(projectId)}`, {
      blockThreshold: 99
    });
    assertEqual(badThreshold.status, 400, 'invalid threshold rejected');

    console.log('plan-ui-controls smoke tests passed');
  } catch (error) {
    throw new Error(`${error.message}\nServer output:\n${serverOutput}`);
  }
}

function reorderPlanTaskForTest(content, fromTaskIndex, toTaskIndex) {
  const { reorderPlanTask } = loadReorderFunctions();
  const result = reorderPlanTask(content, fromTaskIndex, toTaskIndex);
  assert.ok(result !== null, 'reorder result must not be null');
  return result;
}

function editPlanTaskContentForTest(content, taskIndex, newText) {
  const { editPlanTaskContent } = loadTaskActionFunctions();
  const result = editPlanTaskContent(content, taskIndex, newText);
  assertEqual(result.ok, true, 'edit helper result must be ok');
  return result.content;
}

function removePlanTaskContentForTest(content, taskIndex) {
  const { removePlanTaskContent } = loadTaskActionFunctions();
  const result = removePlanTaskContent(content, taskIndex);
  assertEqual(result.ok, true, 'remove helper result must be ok');
  return result.content;
}

function finish(code) {
  if (server && !server.killed) server.kill('SIGTERM');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(code);
}

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    finish(1);
  });
