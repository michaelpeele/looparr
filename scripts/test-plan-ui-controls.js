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

function loadTaskLinkDocStateFunctions(options = {}) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const key = source.match(/^\s*const TASK_LINK_DOC_KEY = .*;$/m);
  assert.ok(key, 'Missing TASK_LINK_DOC_KEY');
  const keyNameMatch = key[0].match(/'([^']+)'/);
  assert.ok(keyNameMatch, 'Missing TASK_LINK_DOC_KEY value');
  const keyName = keyNameMatch[1];
  const load = extractFunction(source, 'function loadTaskLinkDocState()');
  const save = extractFunction(source, 'function saveTaskLinkDocState(value)');
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
    'let taskLinkDocMemory = null;',
    'let taskLinkDocStorageAvailable = true;',
    load,
    save,
    'return { loadTaskLinkDocState, saveTaskLinkDocState };'
  ].join('\n'));
  const helpers = factory(storage);
  helpers.getStored = () => storageMap.get(keyName);
  return helpers;
}

function loadChecklistRenderer(appSource, editingTaskIndex = -1) {
  const renderSource = extractFunction(appSource, 'function renderChecklist(plan)');
  const dom = {
    checklist: {
      innerHTML: '',
      contains: () => false,
      querySelectorAll: () => [],
      querySelector: () => null
    }
  };
  const documentStub = { activeElement: {} };
  const app = { drawerId: 'demo', showCompleted: true };
  const factory = new Function(
    'app',
    'dom',
    'document',
    'editingTaskIndex',
    'esc',
    'updateToggleCompletedButton',
    'updatePlanControls',
    'restoreChecklistFocus',
    'linkPlanReferences',
    `${renderSource}\nreturn { renderChecklist, app, dom };`
  );
  const helpers = factory(
    app,
    dom,
    documentStub,
    editingTaskIndex,
    String,
    () => {},
    () => {},
    () => {},
    () => {}
  );
  return {
    render(plan) {
      helpers.renderChecklist(plan);
      return helpers.dom.checklist.innerHTML;
    }
  };
}

function checklistRows(html) {
  return html
    .split(/(?=<div class="check-item)/)
    .filter((row) => row.startsWith('<div class="check-item'));
}

function checklistActionList(row) {
  const controlsStart = row.indexOf('<div class="task-controls">');
  const labelStart = row.indexOf('<div class="check-label">');
  assert.ok(controlsStart >= 0 && labelStart > controlsStart, 'rendered controls precede label');
  const controls = row.slice(controlsStart, labelStart);
  return [...controls.matchAll(/data-action="([a-z-]+)"/g)].map((match) => match[1]);
}

function checklistButtonDisabled(row, action) {
  const match = row.match(new RegExp(`<button[^>]*data-action="${action}"[^>]*>`));
  assert.ok(match, `rendered control found: ${action}`);
  return /\sdisabled(?:\s|>)/.test(match[0]);
}

function makeStorageMock(options = {}) {
  const entries = options.initial || {};
  const storageMap = new Map(Object.keys(entries).map((name) => [name, entries[name]]));
  return {
    storageMap,
    storage: {
      getItem(name) {
        if (options.failReads) throw new Error('storage read failed');
        return storageMap.has(name) ? storageMap.get(name) : null;
      },
      setItem(name, value) {
        if (options.failWrites) throw new Error('storage write failed');
        storageMap.set(name, value);
      }
    }
  };
}

function loadUiStateFunctions(options = {}) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const key = source.match(/^\s*const UI_STATE_KEY = .*;$/m);
  const sectionKeys = source.match(/^\s*const UI_SECTION_KEYS = .*;$/m);
  assert.ok(key, 'Missing UI_STATE_KEY');
  assert.ok(sectionKeys, 'Missing UI_SECTION_KEYS');
  const keyNameMatch = key[0].match(/'([^']+)'/);
  assert.ok(keyNameMatch, 'Missing UI_STATE_KEY value');
  const keyName = keyNameMatch[1];
  const names = [
    'normalizeUiProjectId',
    'normalizeUiState',
    'loadUiState',
    'saveUiState',
    'getProjectUiState',
    'setProjectUiState',
    'isSectionOpen',
    'setSectionOpen',
    'getPlanGuideState',
    'setPlanGuideState',
    'getLogFollow',
    'setLogFollow'
  ];
  const functions = names.map((name) => {
    const signature = name === 'normalizeUiState' ? 'function normalizeUiState(raw)'
      : name === 'loadUiState' ? 'function loadUiState()'
      : name === 'saveUiState' ? 'function saveUiState(state)'
      : name === 'getProjectUiState' ? 'function getProjectUiState(id)'
      : name === 'setProjectUiState' ? 'function setProjectUiState(id, patch)'
      : name === 'isSectionOpen' ? 'function isSectionOpen(id, sectionKey)'
      : name === 'setSectionOpen' ? 'function setSectionOpen(id, sectionKey, open)'
      : name === 'getPlanGuideState' ? 'function getPlanGuideState(id)'
      : name === 'setPlanGuideState' ? 'function setPlanGuideState(id, open, touched)'
      : name === 'getLogFollow' ? 'function getLogFollow(id)'
      : name === 'setLogFollow' ? 'function setLogFollow(id, value)'
      : `function ${name}(projectId)`;
    return extractFunction(source, signature);
  });
  const { storageMap, storage } = makeStorageMock(options);
  const factory = new Function('localStorage', [
    key[0],
    sectionKeys[0],
    'let uiStateMemory = null;',
    'let uiStateStorageAvailable = true;',
    ...functions,
    `return { ${names.join(', ')} };`
  ].join('\n'));
  const helpers = factory(storage);
  helpers.getStored = () => storageMap.get(keyName);
  helpers.getStoredState = () => {
    const raw = helpers.getStored();
    return raw ? JSON.parse(raw) : null;
  };
  return helpers;
}

function loadSettingsUiStateFunctions(options = {}) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const key = source.match(/^\s*const GLOBAL_SETTINGS_UI_STATE_KEY = .*;$/m);
  const settingsKeys = source.match(/^\s*const SETTINGS_UI_KEYS = .*;$/m);
  assert.ok(key, 'Missing GLOBAL_SETTINGS_UI_STATE_KEY');
  assert.ok(settingsKeys, 'Missing SETTINGS_UI_KEYS');
  const keyNameMatch = key[0].match(/'([^']+)'/);
  assert.ok(keyNameMatch, 'Missing GLOBAL_SETTINGS_UI_STATE_KEY value');
  const keyName = keyNameMatch[1];
  const normalize = extractFunction(source, 'function normalizeSettingsUiState(raw)');
  const load = extractFunction(source, 'function loadSettingsUiState()');
  const save = extractFunction(source, 'function saveSettingsUiState(state)');
  const get = extractFunction(source, 'function getSettingsUiState()');
  const set = extractFunction(source, 'function setSettingsUiState(key, open)');
  const { storageMap, storage } = makeStorageMock(options);
  const factory = new Function('localStorage', [
    key[0],
    settingsKeys[0],
    'let settingsUiMemory = null;',
    'let settingsUiStorageAvailable = true;',
    normalize,
    load,
    save,
    get,
    set,
    'return { normalizeSettingsUiState, loadSettingsUiState, saveSettingsUiState, getSettingsUiState, setSettingsUiState };'
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
  assertIncludes(appSource, 'data-action="move-up"', 'app move-up action');
  assertIncludes(appSource, 'data-action="move-down"', 'app move-down action');
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
  assertIncludes(appSource, 'class="task-controls"', 'app grouped task controls wrapper');
  const controlsMarkupStart = appSource.indexOf('<div class="task-controls">');
  const labelMarkupStart = appSource.indexOf('<div class="check-label">');
  const dragMarkupStart = appSource.indexOf('data-action="drag"');
  const moveMarkupStart = appSource.indexOf('<div class="task-move">');
  const actionsMarkupStart = appSource.indexOf('<div class="task-actions">');
  assert.ok(
    controlsMarkupStart > 0 && labelMarkupStart > controlsMarkupStart && dragMarkupStart > controlsMarkupStart
      && moveMarkupStart > dragMarkupStart && actionsMarkupStart > moveMarkupStart,
    'app task controls wrapper precedes the label and groups drag, move and actions in order'
  );
  const checklistPlan = {
    tasks: [
      { index: 0, text: 'Short task', checked: false },
      { index: 1, text: 'Long task with dependency', checked: true }
    ],
    dependencyStatus: {
      tasks: { 1: { dependencies: [0], blocked: true, reason: 'Needs first task' } }
    }
  };
  const normalRows = checklistRows(loadChecklistRenderer(appSource).render(checklistPlan));
  assertEqual(normalRows.length, 2, 'rendered checklist row count');
  const expectedActions = 'drag,move-top,move-up,move-down,move-bottom,edit-task,remove-task';
  const expectedDisabled = ['true,true,false,false', 'false,false,true,true'];
  normalRows.forEach((row, index) => {
    assertIncludes(row, '<div class="task-controls">', `row ${index} controls first`);
    assert.ok(row.indexOf('<div class="check-label">') > row.indexOf('<div class="task-controls">'), `row ${index} label follows controls`);
    assertEqual(checklistActionList(row).join(','), expectedActions, `row ${index} control set`);
    assertEqual(
      ['move-top', 'move-up', 'move-down', 'move-bottom'].map((action) => checklistButtonDisabled(row, action)).join(','),
      expectedDisabled[index],
      `row ${index} move-button disabled states`
    );
    const buttons = [...row.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    assertEqual(buttons.length, 9, `row ${index} button count`);
    assert.ok(
      buttons.every((button) => button.includes(`data-task-index="${checklistPlan.tasks[index].index}"`)),
      `row ${index} control indexes`
    );
    const flags = [...row.matchAll(/data-action="toggle-flag" data-flag="(merge-previous|deploy-main)" data-task-index="(\d+)"/g)]
      .map((match) => `${match[1]}:${match[2]}`);
    assertEqual(flags.join(','), `merge-previous:${index},deploy-main:${index}`, `row ${index} flag controls`);
  });
  assertIncludes(normalRows[1], 'task-deps warn', 'dependency warning stays in label after controls');
  const editingRows = checklistRows(loadChecklistRenderer(appSource, 1).render(checklistPlan));
  assertEqual(editingRows.length, 2, 'editing checklist row count');
  assertEqual(
    checklistActionList(editingRows[0]).join(','),
    expectedActions,
    'non-editing row keeps edit action'
  );
  assertEqual(
    checklistActionList(editingRows[1]).join(','),
    expectedActions.replace('edit-task', 'save-task'),
    'editing row swaps to save action without moving controls'
  );
  assertEqual(
    ['move-top', 'move-up', 'move-down', 'move-bottom'].map((action) => checklistButtonDisabled(editingRows[1], action)).join(','),
    expectedDisabled[1],
    'editing row keeps disabled states'
  );
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
  assertIncludes(cssSource, '.task-controls', 'css grouped task controls');
  assertIncludes(cssSource, '.checklist { --task-controls-rail: 240px; display: grid; gap: 6px; margin-bottom: 12px; }', 'css checklist control rail');
  assertIncludes(cssSource, 'grid-template-columns: var(--task-controls-rail) minmax(0, 1fr);', 'css fixed checklist grid rail');
  assertIncludes(cssSource, 'align-items: start;', 'css rail top alignment');
  assertIncludes(cssSource, '.task-controls { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; flex-wrap: nowrap; }', 'css non-wrapping task controls');
  assertIncludes(cssSource, 'scrollbar-gutter: stable;', 'css stable drawer scrollbar gutter');
  assertIncludes(cssSource, '.drawer-control-status {', 'css drawer control status block');
  assertIncludes(cssSource, 'left: var(--drawer-gutter);', 'css anchored drawer status');
  assertIncludes(cssSource, '#task-status {', 'css reserved task status block');
  assertIncludes(cssSource, 'flex: 0 0 90px;', 'css reserved task status width');
  assertIncludes(cssSource, '@media (max-width: 900px)', 'css narrow breakpoint');
  const cssNarrowStart = cssSource.indexOf('@media (max-width: 900px)');
  const cssNarrowEnd = cssSource.indexOf('@media (max-width: 640px)');
  const cssNarrow = cssSource.slice(cssNarrowStart, cssNarrowEnd);
  assertIncludes(cssNarrow, '.checklist { --task-controls-rail: 332px; }', 'css narrow touch control rail');
  assertIncludes(cssNarrow, '.task-controls .move-button, .task-controls .drag-handle, .task-controls .icon-button { width: 44px; height: 44px; }', 'css narrow 44x44 controls rule');
  const cssNarrowestStart = cssSource.indexOf('@media (max-width: 520px)');
  const cssNarrowestEnd = cssSource.indexOf('@media (min-width: 901px)');
  const cssNarrowest = cssSource.slice(cssNarrowestStart, cssNarrowestEnd);
  assertIncludes(cssNarrowest, '.drawer-toolbar { --drawer-gutter: 16px; }', 'css narrowest status gutter');
  assertIncludes(cssNarrowest, '.check-item { grid-template-columns: minmax(0, 1fr); row-gap: 6px; }', 'css narrowest stacked checklist row');
  assertIncludes(cssNarrowest, '.task-controls { grid-row: 1; width: 100%; flex-wrap: wrap; justify-content: flex-start; }', 'css narrowest fixed control row');
  assertIncludes(cssNarrowest, '.task-actions { flex-basis: 100%; }', 'css narrowest actions line');
  assertIncludes(cssNarrowest, '.check-label { grid-row: 2; }', 'css narrowest label row');

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
  assertIncludes(indexHtml, 'id="handoff-recovery-toggle"', 'handoff recovery settings checkbox');
  assertIncludes(appSource, "handoffRecovery: $('handoff-recovery-toggle')", 'handoff recovery DOM ref');
  assertIncludes(appSource, 'handoffRecovery: dom.handoffRecovery.checked', 'handoff recovery save body');
  assertIncludes(indexHtml, 'id="self-heal-pill"', 'self-heal state pill');
  assertIncludes(indexHtml, 'data-state="idle"', 'self-heal pill idle default');
  assertIncludes(indexHtml, 'id="self-heal-branch"', 'self-heal branch button');
  assertIncludes(indexHtml, 'id="self-healing-toggle"', 'self-heal settings toggle');
  assertIncludes(appSource, 'function renderSelfHealing', 'self-heal render helper');
  assertIncludes(appSource, 'selfHealingAvailable', 'self-heal availability gate');
  assertIncludes(appSource, 'selfHealing: dom.selfHealing.checked', 'self-heal save body');
  assertIncludes(cssSource, '.self-heal-pill', 'self-heal pill css');
  assertIncludes(cssSource, '[data-state="healing"]', 'self-heal healing state css');
  assertIncludes(cssSource, '.task-add-row.is-sticky', 'sticky add task css class');
  assertIncludes(cssSource, 'position: sticky', 'sticky add task position');
  assertIncludes(cssSource, '-webkit-sticky', 'sticky add task webkit position');
  assertIncludes(appSource, 'addChecklistTask', 'add checklist task retained');
  assertIncludes(appSource, 'Depends on:', 'dependency display retained');
  assertIncludes(appSource, 'dependencyStatus', 'dependency state display retained');
  assertIncludes(cssSource, '.task-deps.warn', 'dependency warning style retained');

  assertIncludes(indexHtml, 'id="task-link-doc"', 'index task-link-doc checkbox');
  assertIncludes(indexHtml, 'id="task-doc-file"', 'index task-doc-file input');
  assertIncludes(appSource, "const PLAN_FILE_PREFIXES = 'PLAN|plan|PROMPT|prompt|ANALYSIS|analysis|RESEARCH|research|INVESTIGATION|investigation|HANDOFF|handoff|PROGRESS|progress';", 'app shared prefix constant');
  assertIncludes(appSource, 'function buildTaskSlug(title)', 'app buildTaskSlug helper');
  assertIncludes(appSource, 'function formatLinkedTask(title, file)', 'app formatLinkedTask helper');
  assertIncludes(appSource, 'async function resolveLinkedDocName(title, override, fileExists)', 'app resolveLinkedDocName helper');
  assertIncludes(appSource, 'PROGRESS|progress', 'app widened prefix list');
  assertIncludes(cssSource, '.task-link-doc-row', 'css task link doc row');

  const serverSource = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
  assertIncludes(serverSource, "const PLAN_FILE_PREFIXES = 'PLAN|plan|PROMPT|prompt|ANALYSIS|analysis|RESEARCH|research|INVESTIGATION|investigation|HANDOFF|handoff|PROGRESS|progress';", 'server shared prefix constant');
  assertIncludes(serverSource, 'PROGRESS|progress', 'server widened prefix list');
  assertEqual(
    (appSource.match(/const PLAN_FILE_PREFIXES = '([^']+)';/) || [null, null])[1],
    (serverSource.match(/const PLAN_FILE_PREFIXES = '([^']+)';/) || [null, null])[1],
    'server and app prefix lists match textually'
  );

  assertIncludes(indexHtml, '(depends: 1, 2)', 'dependency syntax guide retained');

  assertIncludes(appSource, "const UI_STATE_KEY = 'looparr.uiState.v1';", 'ui state key');
  assertIncludes(appSource, "const GLOBAL_SETTINGS_UI_STATE_KEY = 'looparr.settingsUiState.v1';", 'settings ui state key');
  assertIncludes(appSource, "const UI_SECTION_KEYS = ['constraint', 'runner', 'startup', 'questions', 'plan', 'logs', 'sprints'];", 'ui section keys');
  for (const sectionKey of ['constraint', 'runner', 'startup', 'questions', 'plan', 'logs', 'sprints']) {
    assertIncludes(indexHtml, `data-section="${sectionKey}"`, `drawer section ${sectionKey}`);
    assertIncludes(indexHtml, `aria-controls="section-${sectionKey}-body"`, `section controls ${sectionKey}`);
    assertIncludes(indexHtml, `id="section-${sectionKey}-body"`, `section body ${sectionKey}`);
  }
  assertIncludes(indexHtml, 'data-action="toggle-section"', 'section toggle action');
  assertIncludes(indexHtml, 'section-heading-text', 'section heading text');
  assertIncludes(indexHtml, 'section-chevron', 'section chevron');
  for (const settingsKey of ['promptTemplates', 'promptOptions', 'blockPolicy', 'envSettings']) {
    assertIncludes(indexHtml, `data-settings-section="${settingsKey}"`, `settings section ${settingsKey}`);
  }
  for (const helper of [
    'normalizeUiState', 'loadUiState', 'saveUiState', 'getProjectUiState', 'setProjectUiState',
    'isSectionOpen', 'setSectionOpen', 'getPlanGuideState', 'setPlanGuideState', 'getLogFollow',
    'setLogFollow', 'restoreUiStateForProject', 'applyAutoEmptySections', 'syncSectionStates',
    'normalizeSettingsUiState', 'loadSettingsUiState', 'saveSettingsUiState', 'getSettingsUiState',
    'setSettingsUiState', 'syncSettingsUiState'
  ]) {
    assertIncludes(appSource, helper, `ui helper ${helper}`);
  }
  assertIncludes(appSource, 'restoreUiStateForProject(id);', 'openDrawer restores ui state');
  assertIncludes(appSource, 'syncSectionStates(id);', 'openDrawer syncs sections');
  assertIncludes(appSource, 'applyAutoEmptySections(id);', 'auto empty sections applied');
  assertIncludes(appSource, 'setPlanGuideState(app.drawerId, dom.planGuide.open, false);', 'plan guide auto state saved');
  assertIncludes(appSource, 'setLogFollow(app.drawerId, app.logFollow);', 'log follow state saved');
  assertIncludes(appSource, 'setSectionOpen(app.drawerId, sectionKey, open);', 'section state saved');
  assertIncludes(appSource, 'setSettingsUiState(settingsKey, details.open);', 'settings ui state saved');
  const toggleSectionHandler = extractFunction(appSource, 'function handleSectionToggle(event)');
  assert.ok(toggleSectionHandler, 'section toggle handler extracted');
  assertIncludes(toggleSectionHandler, "closest('[data-section]')", 'section toggle finds section');
  assertIncludes(toggleSectionHandler, "button.getAttribute('aria-controls')", 'section toggle finds body');
  assert.ok(!toggleSectionHandler.includes('fetch('), 'section toggle makes no api call');
  assert.ok(!toggleSectionHandler.includes('savePlan('), 'section toggle writes no plan');
  assertIncludes(cssSource, '.section-toggle', 'css section toggle');
  assertIncludes(cssSource, '.section-body[hidden]', 'css hidden section body');
  assertIncludes(cssSource, '[aria-expanded="false"] .section-chevron', 'css collapsed chevron');
  assertIncludes(cssSource, '.section-toggle:focus-visible', 'css section toggle focus');
  assertIncludes(cssSource, 'min-height: 44px', 'css 44px touch target retained');
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

async function testAddChecklistTaskStubFailureAborts() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const addSource = extractFunction(source, 'async function addChecklistTask()');
  const formatSource = extractFunction(source, 'function formatLinkedTask(title, file)');
  const calls = { ensurePlanContent: 0, appendTask: 0, markPlanDirty: 0, savePlanContent: 0 };
  const dom = {
    taskInput: { value: 'Task link checkbox' },
    taskStatus: { textContent: '' },
    taskLinkDoc: { checked: true },
    taskDocFile: { value: '' }
  };
  const app = { drawerId: 'demo', savingPlan: false };
  const factory = new Function(
    'app',
    'dom',
    'cleanTaskText',
    'resolveLinkedDocName',
    'planFileExists',
    'api',
    'formatLinkedTask',
    'ensurePlanContent',
    'appendTask',
    'markPlanDirty',
    'savePlanContent',
    `${addSource}\nreturn addChecklistTask;`
  );
  const addChecklistTask = factory(
    app,
    dom,
    (t) => String(t || '').trim(),
    async () => 'PLAN-task-link-checkbox.md',
    async () => false,
    async () => { throw new Error('boom'); },
    new Function(`${formatSource}\nreturn formatLinkedTask;`)(),
    async () => {
      calls.ensurePlanContent += 1;
      return '# Build plan';
    },
    () => {
      calls.appendTask += 1;
      return '# Build plan\n- [ ] [Task link checkbox](.project_documents/PLAN-task-link-checkbox.md)';
    },
    () => { calls.markPlanDirty += 1; },
    async () => {
      calls.savePlanContent += 1;
      return true;
    }
  );
  await addChecklistTask();
  assert.ok(
    dom.taskStatus.textContent.includes('could not be created'),
    `stub failure sets status message, got ${JSON.stringify(dom.taskStatus.textContent)}`
  );
  assertEqual(calls.ensurePlanContent, 0, 'stub failure aborts before ensurePlanContent');
  assertEqual(calls.appendTask, 0, 'stub failure aborts before appendTask');
  assertEqual(calls.markPlanDirty, 0, 'stub failure aborts before markPlanDirty');
  assertEqual(calls.savePlanContent, 0, 'stub failure writes no plan');
}

function loadAddChecklistTaskRunner(options = {}) {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const addSource = extractFunction(source, 'async function addChecklistTask()');
  const formatSource = extractFunction(source, 'function formatLinkedTask(title, file)');
  const calls = { ensurePlanContent: 0, appendTask: 0, markPlanDirty: 0, savePlanContent: 0, planFileExists: 0 };
  const apiCalls = [];
  const appended = [];
  const composed = [];
  const dom = {
    taskInput: { value: options.title || 'Task link checkbox' },
    taskStatus: { textContent: '' },
    taskLinkDoc: { checked: Boolean(options.checked) },
    taskDocFile: { value: options.docFile || '' },
    planEditor: { value: options.planContent || '# Build plan' }
  };
  const app = { drawerId: 'demo', savingPlan: false };
  const factory = new Function(
    'app',
    'dom',
    'cleanTaskText',
    'resolveLinkedDocName',
    'planFileExists',
    'api',
    'formatLinkedTask',
    'ensurePlanContent',
    'appendTask',
    'markPlanDirty',
    'savePlanContent',
    `${addSource}\nreturn addChecklistTask;`
  );
  const addChecklistTask = factory(
    app,
    dom,
    (t) => String(t || '').trim(),
    async () => 'PLAN-task-link-checkbox.md',
    async () => {
      calls.planFileExists += 1;
      return Boolean(options.exists);
    },
    async (url, requestOptions) => {
      apiCalls.push({ url, method: requestOptions?.method || 'GET', body: requestOptions?.body });
      return { ok: true };
    },
    new Function(`${formatSource}\nreturn formatLinkedTask;`)(),
    async () => {
      calls.ensurePlanContent += 1;
      return '# Build plan';
    },
    (content, text) => {
      calls.appendTask += 1;
      appended.push(text);
      const next = `${content}\n- [ ] ${text}`;
      composed.push(next);
      return next;
    },
    () => { calls.markPlanDirty += 1; },
    async () => {
      calls.savePlanContent += 1;
      return true;
    }
  );
  return { addChecklistTask, calls, apiCalls, appended, composed, dom };
}

async function testAddChecklistTaskLinkDocSuccess() {
  const runner = loadAddChecklistTaskRunner({ checked: true, docFile: '', title: 'Task link checkbox' });
  await runner.addChecklistTask();
  const expected = '(plan) Task link checkbox \u2014 see [PLAN-task-link-checkbox.md](.project_documents/PLAN-task-link-checkbox.md)';
  assertEqual(runner.appended.length, 1, 'success appends one task');
  assertEqual(runner.appended[0], expected, 'success task text built by formatLinkedTask');
  assertEqual(
    runner.composed[0],
    `# Build plan\n- [ ] ${expected}`,
    'success plan line is the linked task'
  );
  assertEqual(runner.calls.planFileExists, 1, 'success checks doc existence once');
  assertEqual(runner.calls.savePlanContent, 1, 'success saves plan exactly once');
  assertEqual(runner.calls.markPlanDirty, 1, 'success marks plan dirty once');

  const put = runner.apiCalls.find((call) => call.method === 'PUT');
  assert.ok(put, 'success issues PUT /plan-file');
  assertEqual(put.url, '/api/projects/demo/plan-file', 'success PUT targets plan-file endpoint');
  assert.deepEqual(
    JSON.parse(put.body),
    { path: '.project_documents/PLAN-task-link-checkbox.md', content: '# Task link checkbox' },
    'success stub body is exact'
  );
  assertEqual(runner.dom.taskStatus.textContent, '', 'success clears status');
  assertEqual(runner.dom.taskInput.value, '', 'success clears task input');
}

async function testAddChecklistTaskUnchecked() {
  const runner = loadAddChecklistTaskRunner({ checked: false, docFile: '', title: 'Task link checkbox' });
  await runner.addChecklistTask();
  assertEqual(runner.apiCalls.length, 0, 'unchecked makes no api calls');
  assertEqual(runner.calls.planFileExists, 0, 'unchecked skips existence check');
  assertEqual(runner.appended.length, 1, 'unchecked appends one task');
  assertEqual(runner.appended[0], 'Task link checkbox', 'unchecked task text is plain');
  assertEqual(
    runner.composed[0],
    '# Build plan\n- [ ] Task link checkbox',
    'unchecked plan line is byte-identical to legacy behavior'
  );
  assertEqual(runner.calls.savePlanContent, 1, 'unchecked saves plan exactly once');
  assertEqual(runner.calls.markPlanDirty, 1, 'unchecked marks plan dirty once');
}

function makeLinkifyDocument() {
  function createTextNode(value) {
    return { nodeType: 3, nodeValue: String(value), parentNode: null, childNodes: [] };
  }
  function createElement(tag) {
    return {
      nodeType: 1,
      tagName: tag,
      className: '',
      dataset: {},
      title: '',
      textContent: '',
      parentNode: null,
      childNodes: [],
      setAttribute(name, value) { this[name] = value; },
      appendChild(node) {
        node.parentNode = this;
        this.childNodes.push(node);
        return node;
      },
      replaceChild(newNode, oldNode) {
        const index = this.childNodes.indexOf(oldNode);
        if (index >= 0) this.childNodes.splice(index, 1, ...newNode.childNodes);
        newNode.childNodes.forEach((node) => { node.parentNode = this; });
        oldNode.parentNode = null;
        return oldNode;
      }
    };
  }
  function createDocumentFragment() {
    const node = createElement('#fragment');
    node.nodeType = 11;
    return node;
  }
  function createTreeWalker(root) {
    const nodes = [];
    (function collect(node) {
      if (node.nodeType === 3) nodes.push(node);
      (node.childNodes || []).forEach(collect);
    })(root);
    let index = -1;
    return {
      get currentNode() { return nodes[index]; },
      nextNode() {
        index += 1;
        return index < nodes.length ? nodes[index] : null;
      }
    };
  }
  return { createTextNode, createElement, createDocumentFragment, createTreeWalker };
}

function loadLinkPlanReferences() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'public/app.js'), 'utf8');
  const prefixes = source.match(/^\s*const PLAN_FILE_PREFIXES = '([^']+)';$/m);
  assert.ok(prefixes, 'Missing PLAN_FILE_PREFIXES');
  const normalize = extractFunction(source, 'function normalizePlanFilePath(target)');
  const baseName = extractFunction(source, 'function planFileBaseName(relativePath)');
  const button = extractFunction(source, 'function createPlanFileButton(label, projectId, relativePath)');
  const linkify = extractFunction(source, 'function linkPlanReferences(element, projectId)');
  const NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  const document = makeLinkifyDocument();
  const factory = new Function('document', 'NodeFilter', [
    prefixes[0],
    normalize,
    baseName,
    button,
    linkify,
    'return { linkPlanReferences };'
  ].join('\n'));
  return { linkPlanReferences: factory(document, NodeFilter).linkPlanReferences, document };
}

function testLinkPlanReferences() {
  const { linkPlanReferences, document } = loadLinkPlanReferences();

  const root = document.createElement('div');
  root.appendChild(document.createTextNode('See HANDOFF-review.md for details'));
  linkPlanReferences(root, 'demo');
  const buttons = root.childNodes.filter((node) => node.nodeType === 1);
  assertEqual(buttons.length, 1, 'linkify creates one button for widened prefix');
  assert.ok(buttons[0].className.includes('plan-file-ref'), 'linkify button uses plan-file-ref class');
  assertEqual(buttons[0].dataset.planFile, 'HANDOFF-review.md', 'linkify button targets widened prefix file');
  assertEqual(buttons[0].textContent, 'HANDOFF-review.md', 'linkify button label is the file name');
  assert.ok(
    root.childNodes.some((node) => node.nodeType === 3 && node.nodeValue.includes('See ')),
    'linkify keeps leading text'
  );
  assert.ok(
    root.childNodes.some((node) => node.nodeType === 3 && node.nodeValue.includes(' for details')),
    'linkify keeps trailing text'
  );

  const markdownRoot = document.createElement('div');
  markdownRoot.appendChild(document.createTextNode('Read [PROGRESS-notes.md](.project_documents/PROGRESS-notes.md) now'));
  linkPlanReferences(markdownRoot, 'demo');
  const markdownButtons = markdownRoot.childNodes.filter((node) => node.nodeType === 1);
  assertEqual(markdownButtons.length, 1, 'linkify handles markdown link form');
  assertEqual(markdownButtons[0].dataset.planFile, '.project_documents/PROGRESS-notes.md', 'markdown link keeps relative path');

  const plainRoot = document.createElement('div');
  plainRoot.appendChild(document.createTextNode('Plain task with no references'));
  linkPlanReferences(plainRoot, 'demo');
  assertEqual(plainRoot.childNodes.length, 1, 'linkless row keeps single text node');
  assertEqual(plainRoot.childNodes[0].nodeType, 3, 'linkless row stays plain text');
}

async function testPlanFileApiGate(projectId) {
  const docsDir = path.join(DEMO_DIR, '.project_documents');
  fs.mkdirSync(docsDir, { recursive: true });
  const progressPath = '.project_documents/PROGRESS-edge-cases.md';
  const putOk = await api(
    'PUT',
    `/api/projects/${encodeURIComponent(projectId)}/plan-file?path=${encodeURIComponent(progressPath)}`,
    { content: '# Edge cases' }
  );
  assertEqual(putOk.status, 200, 'PROGRESS plan-file PUT accepted');

  const getOk = await api(
    'GET',
    `/api/projects/${encodeURIComponent(projectId)}/plan-file?path=${encodeURIComponent(progressPath)}`
  );
  assertEqual(getOk.status, 200, 'PROGRESS plan-file GET status');
  assertEqual(getOk.body.content, '# Edge cases', 'PROGRESS plan-file GET returns written content');
  assert.ok(
    fs.existsSync(path.join(docsDir, 'PROGRESS-edge-cases.md')),
    'PROGRESS plan-file exists on disk'
  );

  const notePath = '.project_documents/NOTE-edge-cases.md';
  const putBad = await api(
    'PUT',
    `/api/projects/${encodeURIComponent(projectId)}/plan-file?path=${encodeURIComponent(notePath)}`,
    { content: '# Nope' }
  );
  assertEqual(putBad.status, 400, 'non-plan prefix rejected with 400');
  assert.ok(
    !fs.existsSync(path.join(docsDir, 'NOTE-edge-cases.md')),
    'rejected plan-file writes nothing'
  );
}

function testTaskLinkDocStateFunctions() {
  const helpers = loadTaskLinkDocStateFunctions();
  assertEqual(helpers.loadTaskLinkDocState(), false, 'task link doc defaults unchecked with empty storage');
  helpers.saveTaskLinkDocState(true);
  assertEqual(helpers.loadTaskLinkDocState(), true, 'task link doc true round-trips');
  assertEqual(helpers.getStored(), 'true', 'task link doc stored as string');
  helpers.saveTaskLinkDocState(false);
  assertEqual(helpers.loadTaskLinkDocState(), false, 'task link doc false round-trips');

  const saved = loadTaskLinkDocStateFunctions({ initial: { 'looparr.taskLinkDoc': 'true' } });
  assertEqual(saved.loadTaskLinkDocState(), true, 'stored true restores checked');
  const unchecked = loadTaskLinkDocStateFunctions({ initial: { 'looparr.taskLinkDoc': 'false' } });
  assertEqual(unchecked.loadTaskLinkDocState(), false, 'stored false restores unchecked');
}

async function testUiStatePureFunctions() {
  const helpers = loadUiStateFunctions();
  assert.deepEqual(helpers.normalizeUiState(null), {}, 'ui state default');
  assert.deepEqual(helpers.normalizeUiState([]), {}, 'array ui state ignored');
  assert.deepEqual(helpers.normalizeUiState('bad'), {}, 'string ui state ignored');
  assert.deepEqual(
    helpers.normalizeUiState({
      A: {
        sections: { questions: true, logs: false, plan: 'yes', unknown: true },
        planGuide: { open: true, touched: 'yes' },
        logFollow: false
      },
      B: null,
      C: [],
      '': { logFollow: true },
      '   ': { logFollow: true }
    }),
    {
      A: {
        sections: { questions: true, logs: false },
        planGuide: { open: true },
        logFollow: false
      }
    },
    'ui state keeps only booleans and ignores invalid project ids'
  );

  assertEqual(helpers.isSectionOpen('A', 'questions'), null, 'section choice absent before write');
  helpers.setSectionOpen('A', 'questions', false);
  assertEqual(helpers.isSectionOpen('A', 'questions'), false, 'explicit collapsed choice stored');
  helpers.setSectionOpen('A', 'runner', true);
  assertEqual(helpers.isSectionOpen('A', 'runner'), true, 'explicit expanded choice stored');
  assertEqual(helpers.isSectionOpen('A', 'logs'), null, 'other sections have no choice');
  assertEqual(helpers.isSectionOpen('', 'questions'), null, 'empty project id ignored on read');
  helpers.setSectionOpen('', 'questions', true);
  assertEqual(helpers.getStoredState()[''], undefined, 'empty project id ignored on write');
  helpers.setSectionOpen('A', 'unknown', true);
  assertEqual(helpers.getStoredState().A.sections.unknown, undefined, 'unknown section ignored');

  assertEqual(helpers.getLogFollow('A'), true, 'log follow defaults to true');
  helpers.setLogFollow('A', false);
  assertEqual(helpers.getLogFollow('A'), false, 'log follow choice stored');
  assertEqual(helpers.getLogFollow('B'), true, 'log follow choice does not leak');
  helpers.setLogFollow('B', false);
  assertEqual(helpers.getLogFollow('A'), false, 'log follow survives another project write');

  helpers.setPlanGuideState('A', true, true);
  assert.deepEqual(helpers.getPlanGuideState('A'), { open: true, touched: true }, 'manual plan guide choice wins');
  assert.deepEqual(helpers.getPlanGuideState('B'), { open: false, touched: false }, 'plan guide choice does not leak');

  const stored = loadUiStateFunctions({
    initial: {
      'looparr.uiState.v1': JSON.stringify({
        demo: {
          sections: { questions: false },
          planGuide: { open: true, touched: true },
          logFollow: false
        }
      })
    }
  });
  assertEqual(stored.isSectionOpen('demo', 'questions'), false, 'stored section choice restored');
  assertEqual(stored.getLogFollow('demo'), false, 'stored log follow restored');
  assert.deepEqual(stored.getPlanGuideState('demo'), { open: true, touched: true }, 'stored plan guide restored');

  const corrupt = loadUiStateFunctions({ initial: { 'looparr.uiState.v1': '{not json' } });
  assert.deepEqual(corrupt.loadUiState(), {}, 'corrupt ui state defaults to empty');

  const offline = loadUiStateFunctions({ failReads: true, failWrites: true });
  offline.setSectionOpen('offline', 'logs', false);
  assertEqual(offline.isSectionOpen('offline', 'logs'), false, 'ui state memory fallback works');
  assertEqual(offline.getStored(), undefined, 'ui state storage failure writes nothing');

  const settings = loadSettingsUiStateFunctions();
  settings.setSettingsUiState('envSettings', true);
  assert.deepEqual(settings.getSettingsUiState(), { envSettings: true }, 'settings details state stored');
  settings.setSettingsUiState('unknown', true);
  assert.deepEqual(settings.getSettingsUiState(), { envSettings: true }, 'unknown settings key ignored');
  assertEqual(helpers.getStoredState().envSettings, undefined, 'settings key isolated from ui key');

  const settingsStored = loadSettingsUiStateFunctions({
    initial: {
      'looparr.settingsUiState.v1': JSON.stringify({ envSettings: true, bad: 'yes' })
    }
  });
  assert.deepEqual(settingsStored.getSettingsUiState(), { envSettings: true }, 'settings details state restored');

  const settingsOffline = loadSettingsUiStateFunctions({ failReads: true, failWrites: true });
  settingsOffline.setSettingsUiState('blockPolicy', false);
  assert.deepEqual(
    settingsOffline.getSettingsUiState(),
    { blockPolicy: false },
    'settings details memory fallback works'
  );
  assertEqual(settingsOffline.getStored(), undefined, 'settings storage failure writes nothing');
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
    await testUiStatePureFunctions();
    await testAddChecklistTaskStubFailureAborts();
    await testAddChecklistTaskLinkDocSuccess();
    await testAddChecklistTaskUnchecked();
    testLinkPlanReferences();
    testTaskLinkDocStateFunctions();

    const created = await api('POST', '/api/projects', {
      name: 'demo',
      path: DEMO_DIR,
      runner: 'opencode'
    });
    assertEqual(created.status, 201, 'project create status');
    const projectId = created.body.project.id;

    await testPlanFileApiGate(projectId);

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
  fs.rmSync(path.join(DEMO_DIR, '.project_documents'), { recursive: true, force: true });
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(code);
}

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    finish(1);
  });
