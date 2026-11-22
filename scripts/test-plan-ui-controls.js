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

function loadExpansionFunctions() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const fields = source.match(/^\s*const TASK_FIELDS = .*;$/m);
  assert.ok(fields, 'Missing TASK_FIELDS');
  const normalize = extractFunction(source, 'function normalizeExpansionState(raw)');
  const overflow = extractFunction(source, 'function hasTaskOverflow(textEl)');
  const isExpanded = extractFunction(source, 'function isTaskExpanded(projectId, field)');
  const setExpanded = extractFunction(source, 'function setTaskExpansion(projectId, field, expanded)');
  const factory = new Function('getState', 'saveState', [
    fields[0],
    normalize,
    overflow,
    'function loadExpansionState() { return getState(); }',
    'function saveExpansionState(state) { saveState(state); }',
    isExpanded,
    setExpanded,
    'return { normalizeExpansionState, hasTaskOverflow, isTaskExpanded, setTaskExpansion };'
  ].join('\n'));
  let current = {};
  const helpers = factory(() => current, (state) => { current = state; });
  helpers.getState = () => current;
  return helpers;
}

function loadShowCompletedFunctions(options = {}) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const key = source.match(/^\s*const SHOW_COMPLETED_KEY = .*;$/m);
  assert.ok(key, 'Missing SHOW_COMPLETED_KEY');
  const keyNameMatch = key[0].match(/'([^']+)'/);
  assert.ok(keyNameMatch, 'Missing SHOW_COMPLETED_KEY value');
  const keyName = keyNameMatch[1];
  const normalize = extractFunction(source, 'function normalizeShowCompletedState(raw)');
  const load = extractFunction(source, 'function loadShowCompletedState()');
  const save = extractFunction(source, 'function saveShowCompletedState(state)');
  const isShown = extractFunction(source, 'function isShowCompleted(projectId)');
  const setShown = extractFunction(source, 'function setShowCompleted(projectId, show)');
  const entries = options.initial || {};
  const storageMap = new Map(Object.keys(entries).map((name) => [name, entries[name]]));
  const storage = {
    getItem(name) {
      if (options.failReads) throw new Error('storage read failed');
      return storageMap.has(name) ? storageMap.get(name) : null;
    },
    setItem(name, value) {
      if (options.failWrites) throw new Error('storage write failed');
      storageMap.set(name, value);
    }
  };
  const factory = new Function('localStorage', [
    key[0],
    'let showCompletedMemory = null;',
    'let showCompletedStorageAvailable = true;',
    normalize,
    load,
    save,
    isShown,
    setShown,
    'return { normalizeShowCompletedState, loadShowCompletedState, saveShowCompletedState, isShowCompleted, setShowCompleted };'
  ].join('\n'));
  const helpers = factory(storage);
  helpers.getStored = () => storageMap.get(keyName);
  helpers.getStoredState = () => {
    const raw = helpers.getStored();
    return raw ? JSON.parse(raw) : null;
  };
  return helpers;
}

function assertServedAssets(indexHtml, appSource, cssSource) {
  assertIncludes(indexHtml, 'id="toggle-completed-tasks"', 'index toggle id');
  assertIncludes(indexHtml, 'data-action="toggle-completed"', 'index toggle action');
  assertIncludes(indexHtml, 'type="button"', 'index toggle type');
  assertIncludes(indexHtml, 'aria-pressed="false"', 'index toggle hidden default');
  assertIncludes(indexHtml, 'aria-label="Show completed tasks in the checklist"', 'index toggle hidden aria label');
  assertIncludes(indexHtml, 'title="Show completed tasks in the checklist"', 'index toggle hidden title');
  assertIncludes(indexHtml, '⊞', 'index toggle hidden icon');
  assertIncludes(indexHtml, 'Show completed</button>', 'index toggle hidden label');

  assertIncludes(appSource, 'toggleCompletedTasks: $(\'toggle-completed-tasks\')', 'app toggle dom binding');
  assertIncludes(appSource, 'showCompleted: false', 'app showCompleted hidden default');
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
  assertIncludes(toggleSource, 'setShowCompleted(app.drawerId, show)', 'toggleCompleted persists before state flip');
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

  assertIncludes(indexHtml, 'id="drawer-task-toggle"', 'index current task toggle id');
  assertIncludes(indexHtml, 'id="drawer-next-toggle"', 'index up next toggle id');
  assertIncludes(indexHtml, 'data-task-field="current"', 'index current field');
  assertIncludes(indexHtml, 'data-task-field="next"', 'index next field');
  assertIncludes(indexHtml, 'data-project-id=""', 'index dynamic project id slot');
  assertIncludes(indexHtml, 'class="task-detail-text task-detail-clamped"', 'index clamped text span');
  assertIncludes(indexHtml, 'class="task-expand-toggle"', 'index expand toggle class');
  assertIncludes(indexHtml, 'aria-controls="drawer-task"', 'index current toggle control');
  assertIncludes(indexHtml, 'aria-controls="drawer-next"', 'index next toggle control');
  assertIncludes(indexHtml, 'aria-expanded="false"', 'index toggle default collapsed');
  assertIncludes(indexHtml, 'aria-label="Expand current task"', 'index current toggle label');
  assertIncludes(indexHtml, 'title="Expand up next"', 'index next toggle title');
  assertIncludes(indexHtml, 'hidden>▼</button>', 'index collapsed chevron');

  assertIncludes(appSource, "drawerTaskToggle: $('drawer-task-toggle')", 'app current toggle binding');
  assertIncludes(appSource, "drawerNextToggle: $('drawer-next-toggle')", 'app next toggle binding');
  assertIncludes(appSource, "const TASK_EXPANSION_KEY = 'looparr.taskExpansion.v1'", 'app expansion storage key');
  assertIncludes(appSource, "const TASK_FIELDS = ['current', 'next']", 'app expansion fields');
  assertIncludes(appSource, 'function normalizeExpansionState(raw)', 'app expansion normalizer');
  assertIncludes(appSource, 'function isTaskExpanded(projectId, field)', 'app expansion reader');
  assertIncludes(appSource, 'function setTaskExpansion(projectId, field, expanded)', 'app expansion writer');
  assertIncludes(appSource, 'function hasTaskOverflow(textEl)', 'app overflow helper');
  assertIncludes(appSource, 'function syncTaskExpansion(projectId, field)', 'app expansion sync');
  assertIncludes(appSource, 'function syncAllTaskExpansion()', 'app all instances sync');
  assertIncludes(appSource, 'function bindTaskToggle(button)', 'app toggle binding helper');
  assertIncludes(appSource, 'normalized[field] = entry[field] === true', 'app expansion default false');
  assertIncludes(appSource, 'state[String(projectId)][field] = Boolean(expanded)', 'app immediate expansion write');
  assertIncludes(appSource, 'if (expansionMemory !== null) return normalizeExpansionState(expansionMemory);', 'app memory state authoritative');
  assertIncludes(appSource, 'if (!expansionStorageAvailable) return;', 'app storage failure fallback');
  assertIncludes(appSource, "const SHOW_COMPLETED_KEY = 'looparr.showCompleted.v1'", 'app show completed storage key');
  assertIncludes(appSource, 'function normalizeShowCompletedState(raw)', 'app show completed normalizer');
  assertIncludes(appSource, 'function loadShowCompletedState()', 'app show completed loader');
  assertIncludes(appSource, 'function saveShowCompletedState(state)', 'app show completed writer');
  assertIncludes(appSource, 'function isShowCompleted(projectId)', 'app show completed reader');
  assertIncludes(appSource, 'function setShowCompleted(projectId, show)', 'app show completed setter');
  assertIncludes(appSource, 'function restoreShowCompletedForProject(id)', 'app show completed restore helper');
  assertIncludes(appSource, 'result[String(projectId)] = raw[projectId] === true', 'app show completed default hidden');
  assertIncludes(appSource, 'state[String(projectId)] = show === true', 'app show completed immediate write');
  assertIncludes(appSource, 'if (showCompletedMemory !== null) return normalizeShowCompletedState(showCompletedMemory);', 'app show completed memory authoritative');
  assertIncludes(appSource, 'if (!showCompletedStorageAvailable) return;', 'app show completed storage failure fallback');

  const openDrawerSource = extractFunction(appSource, 'function openDrawer(id)');
  const closeDrawerSource = extractFunction(appSource, 'function closeDrawer()');
  assertIncludes(openDrawerSource, 'restoreShowCompletedForProject(id)', 'app drawer restores saved state');
  assertIncludes(openDrawerSource, 'loadPlan(id)', 'app drawer loads plan');
  assert.ok(
    openDrawerSource.indexOf('restoreShowCompletedForProject(id)') < openDrawerSource.indexOf('loadPlan(id)'),
    'app drawer restores saved state before first checklist render'
  );
  assert.ok(!openDrawerSource.includes('app.showCompleted = true'), 'openDrawer must not force shown');
  assert.ok(!closeDrawerSource.includes('app.showCompleted = true'), 'closeDrawer must not force shown');

  assertIncludes(appSource, 'scrollHeight > textEl.clientHeight + 1', 'app overflow tolerance');
  assertIncludes(appSource, "wrapper.dataset.fallback === 'true'", 'app fallback skip');
  assertIncludes(appSource, "text !== '—'", 'app dash skip');
  assertIncludes(appSource, "toggle.textContent = visuallyExpanded ? '▲' : '▼'", 'app chevron flip');
  assertIncludes(appSource, "toggle.setAttribute('aria-expanded', String(visuallyExpanded))", 'app aria sync');
  assertIncludes(appSource, 'event.stopPropagation()', 'app toggle propagation stop');
  assertIncludes(appSource, "window.addEventListener('resize', syncAllTaskExpansion)", 'app resize resync');
  assertIncludes(appSource, 'task-detail-text', 'app detail text class');
  assertIncludes(appSource, 'task-expand-toggle', 'app expand toggle class');
  assertIncludes(appSource, 'dataset.projectId', 'app dynamic project id');
  assertIncludes(appSource, 'currentText.textContent = project.currentTask || taskFallback(project)', 'app card current textContent');
  assertIncludes(appSource, 'upText.textContent = project.nextTask || \'—\'', 'app card next textContent');
  assertIncludes(appSource, 'dom.drawerTask.textContent = project.currentTask || taskFallback(project)', 'app drawer current textContent');
  assertIncludes(appSource, 'dom.drawerNext.textContent = project.nextTask || \'—\'', 'app drawer next textContent');
  assert.ok(!appSource.includes("card.querySelector('.card-up').innerHTML"), 'card up next must not use innerHTML');
  assert.ok(!appSource.includes('Up next:</strong> ${esc(project.nextTask)}'), 'card up next must not interpolate task text');

  assertIncludes(cssSource, '.task-detail-clamped', 'css clamped text class');
  assertIncludes(cssSource, '-webkit-line-clamp:3', 'css three line clamp');
  assertIncludes(cssSource, '-webkit-box-orient:vertical', 'css clamp orientation');
  assertIncludes(cssSource, '.task-detail-expanded', 'css expanded text class');
  assertIncludes(cssSource, '.task-expand-toggle', 'css toggle button class');
  assertIncludes(cssSource, 'min-height: 44px', 'css toggle tap target height');
  assertIncludes(cssSource, 'min-width: 44px', 'css toggle tap target width');
  assertIncludes(cssSource, ':focus-visible', 'css toggle focus outline');
  assertIncludes(cssSource, '[hidden] { display: none !important; }', 'css hidden toggle');
  assertIncludes(cssSource, 'overflow-wrap: anywhere', 'css task text wrapping');

  assertIncludes(indexHtml, 'id="sticky-add-task-row"', 'sticky add task settings checkbox');
  assertIncludes(appSource, "stickyAddTaskRow: $('sticky-add-task-row')", 'sticky add task DOM ref');
  assertIncludes(appSource, 'stickyAddTaskRow: dom.stickyAddTaskRow.checked', 'sticky add task save body');
  assertIncludes(cssSource, '.task-add-row.is-sticky', 'sticky add task css class');
  assertIncludes(cssSource, 'position: sticky', 'sticky add task position');
  assertIncludes(cssSource, '-webkit-sticky', 'sticky add task webkit position');
  assertIncludes(appSource, 'addChecklistTask', 'add checklist task retained');
  assertIncludes(appSource, 'Depends on:', 'dependency display retained');
  assertIncludes(appSource, 'dependencyStatus', 'dependency state display retained');
  assertIncludes(cssSource, '.task-deps.warn', 'dependency warning style retained');
  assertIncludes(indexHtml, '(depends: 1, 2)', 'dependency syntax guide retained');
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

async function testExpansionPureFunctions() {
  const helpers = loadExpansionFunctions();
  assert.deepEqual(helpers.normalizeExpansionState(null), {}, 'expansion default state');
  assert.deepEqual(helpers.normalizeExpansionState([]), {}, 'array expansion state ignored');
  assert.deepEqual(
    helpers.normalizeExpansionState({
      demo: { current: true, next: 'yes', extra: true },
      broken: null,
      list: []
    }),
    { demo: { current: true, next: false } },
    'expansion state keeps only true current/next booleans'
  );
  assertEqual(helpers.hasTaskOverflow(null), false, 'missing text does not overflow');
  assertEqual(helpers.hasTaskOverflow({ scrollHeight: 10, clientHeight: 9 }), false, 'one pixel rounding tolerated');
  assertEqual(helpers.hasTaskOverflow({ scrollHeight: 11, clientHeight: 9 }), true, 'real overflow detected');
  assertEqual(helpers.isTaskExpanded('demo', 'current'), false, 'missing expansion state defaults to collapsed');
  helpers.setTaskExpansion('demo', 'current', true);
  assertEqual(helpers.getState().demo.current, true, 'expansion write persists immediately');
  helpers.setTaskExpansion('demo', 'next', 'yes');
  assertEqual(helpers.getState().demo.next, true, 'truthy expansion write coerced to true');
  helpers.setTaskExpansion('demo', 'other', true);
  assertEqual(helpers.getState().demo.other, undefined, 'invalid expansion field ignored');
  helpers.setTaskExpansion('', 'current', true);
  assertEqual(helpers.getState()[''], undefined, 'empty project id ignored');
}

async function testShowCompletedPureFunctions() {
  const helpers = loadShowCompletedFunctions();
  assert.deepEqual(helpers.normalizeShowCompletedState(null), {}, 'show completed default state');
  assert.deepEqual(helpers.normalizeShowCompletedState([]), {}, 'array show completed state ignored');
  assert.deepEqual(
    helpers.normalizeShowCompletedState({ demo: true, bad: 'yes', off: false, num: 1 }),
    { demo: true, bad: false, off: false, num: false },
    'show completed state keeps only true booleans'
  );
  assertEqual(helpers.isShowCompleted('unknown'), false, 'unknown project defaults to hidden');
  assertEqual(helpers.isShowCompleted(''), false, 'empty project id defaults to hidden');
  helpers.setShowCompleted('', true);
  assertEqual(helpers.getStored(), undefined, 'empty project id write ignored');
  helpers.setShowCompleted('A', true);
  assertEqual(helpers.getStoredState().A, true, 'show completed write persists immediately');
  helpers.setShowCompleted('B', false);
  assertEqual(helpers.getStoredState().A, true, 'project A setting survives project B write');
  assertEqual(helpers.getStoredState().B, false, 'project B hidden setting stored');
  assertEqual(helpers.isShowCompleted('A'), true, 'project A restored as shown');
  assertEqual(helpers.isShowCompleted('B'), false, 'project B restored as hidden');
  helpers.setShowCompleted('bad', 'yes');
  assertEqual(helpers.getStoredState().bad, false, 'invalid value stored as hidden');
  helpers.setShowCompleted('A', false);
  assertEqual(helpers.isShowCompleted('A'), false, 'toggle back to hidden persists');

  const stored = loadShowCompletedFunctions({
    initial: {
      'looparr.showCompleted.v1': JSON.stringify({ demo: true, bad: 'yes', off: false })
    }
  });
  assertEqual(stored.isShowCompleted('demo'), true, 'stored true restores shown');
  assertEqual(stored.isShowCompleted('bad'), false, 'stored invalid value defaults hidden');
  assertEqual(stored.isShowCompleted('off'), false, 'stored false defaults hidden');

  const offline = loadShowCompletedFunctions({ failReads: true, failWrites: true });
  offline.setShowCompleted('offline', true);
  assertEqual(offline.isShowCompleted('offline'), true, 'memory fallback keeps shown state');
  assertEqual(offline.getStored(), undefined, 'storage failure writes nothing');
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
    await testExpansionPureFunctions();
    await testShowCompletedPureFunctions();

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
