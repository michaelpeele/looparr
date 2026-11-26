'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMP_DIR = path.join(REPO_ROOT, '.tmp-terminal-overlay-test');
const PROJECTS_ROOT = path.join(TEMP_DIR, 'projects');
const CONFIG_PATH = path.join(TEMP_DIR, 'config.json');
const BASE_URL = 'http://127.0.0.1:4210';

process.env.PORT = '4210';
process.env.HOST = '127.0.0.1';
process.env.CONFIG_PATH = CONFIG_PATH;
process.env.LOOPARR_PROJECTS_ROOT = PROJECTS_ROOT;

let server = null;

function assertEqual(actual, expected, label) {
  assert.equal(actual, expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(text, fragment, label) {
  assert.ok(String(text).includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
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

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function makeElement() {
  const el = {
    className: '',
    textContent: '',
    dataset: {},
    children: [],
    scrollTop: 0,
    scrollHeight: 120,
    parentChildren: null,
    focusCount: 0,
    append(...nodes) {
      el.children.push(...nodes);
      nodes.forEach((node) => {
        node.parentChildren = el.children;
      });
    },
    appendChild(node) {
      if (node && node.isFragment) {
        node.children.forEach((child) => {
          child.parentChildren = el.children;
        });
        el.children.push(...node.children);
        node.children = [];
      } else {
        node.parentChildren = el.children;
        el.children.push(node);
      }
      return node;
    },
    remove() {
      if (el.parentChildren) {
        const index = el.parentChildren.indexOf(el);
        if (index >= 0) el.parentChildren.splice(index, 1);
      }
      el.removed = true;
    },
    focus() {
      el.focusCount += 1;
    },
    querySelector(selector) {
      const seqMatch = selector.match(/^\[data-seq="(.+)"\]$/);
      for (const child of el.children) {
        if (seqMatch) {
          if (String(child.dataset.seq) === seqMatch[1]) return child;
          continue;
        }
        const first = String(child.className).split(' ')[0];
        if (first && selector.startsWith(`.${first}`)) return child;
      }
      return null;
    }
  };
  return el;
}

function makeDocumentStub() {
  return {
    body: { style: {} },
    createElement() {
      return makeElement();
    },
    createDocumentFragment() {
      const fragment = makeElement();
      fragment.isFragment = true;
      return fragment;
    }
  };
}

function loadLogLineFunctions() {
  const source = readRepoFile('public/app.js');
  const streamClass = extractFunction(source, 'function streamClass(stream)');
  const makeLogLine = extractFunction(source, 'function makeLogLine(entry)');
  const factory = new Function('document', [
    streamClass,
    makeLogLine,
    'return { streamClass, makeLogLine };'
  ].join('\n'));
  return factory(makeDocumentStub());
}

function loadRenderTerminalLogs(logs) {
  const source = readRepoFile('public/app.js');
  const streamClass = extractFunction(source, 'function streamClass(stream)');
  const makeLogLine = extractFunction(source, 'function makeLogLine(entry)');
  const renderLogs = extractFunction(source, 'function renderTerminalLogs(id)');
  const factory = new Function('app', 'dom', 'document', [
    streamClass,
    makeLogLine,
    renderLogs,
    'return { renderTerminalLogs };'
  ].join('\n'));
  const dom = { terminalLogList: makeElement() };
  const helpers = factory({ logs }, dom, makeDocumentStub());
  return { dom: dom.terminalLogList, renderTerminalLogs: helpers.renderTerminalLogs };
}

function loadOverlayFunctions({ drawerId = null, open = false } = {}) {
  const source = readRepoFile('public/app.js');
  const streamClass = extractFunction(source, 'function streamClass(stream)');
  const makeLogLine = extractFunction(source, 'function makeLogLine(entry)');
  const appendLine = extractFunction(source, 'function appendTerminalLine(entry)');
  const isTerminalOpen = extractFunction(source, 'function isTerminalOpen()');
  const openFn = extractFunction(source, 'function openTerminal(id)');
  const closeFn = extractFunction(source, 'function closeTerminal()');
  const documentStub = makeDocumentStub();
  const dom = {
    terminalLogList: makeElement(),
    terminalOverlay: makeElement(),
    terminalTitle: makeElement(),
    terminalClose: makeElement()
  };
  dom.terminalOverlay.hidden = !open;
  const app = {
    terminalId: open ? 'p1' : null,
    drawerId
  };
  const calls = { renderTerminalLogs: [] };
  const factory = new Function('app', 'dom', 'document', 'calls', [
    "function projectById(id) { return id === 'p1' ? { id: 'p1', name: 'Demo' } : null; }",
    'function renderTerminalLogs(id) { calls.renderTerminalLogs.push(id); }',
    streamClass,
    makeLogLine,
    isTerminalOpen,
    appendLine,
    openFn,
    closeFn,
    'return { appendTerminalLine, openTerminal, closeTerminal };'
  ].join('\n'));
  const helpers = factory(app, dom, documentStub, calls);
  helpers.app = app;
  helpers.dom = dom;
  helpers.documentStub = documentStub;
  helpers.calls = calls;
  return helpers;
}

function testStaticMarkup() {
  const html = readRepoFile('public/index.html');
  assertIncludes(html, 'id="icon-terminal"', 'sprite symbol');
  assertIncludes(html, 'terminal-button', 'terminal button class');
  assertIncludes(html, 'id="terminal-overlay"', 'overlay id');
  assertIncludes(html, 'id="terminal-log-list"', 'overlay log list id');
  assertIncludes(html, 'id="terminal-close"', 'overlay close button id');
  assertIncludes(html, 'id="drawer-terminal-button"', 'drawer terminal button id');
  const overlayStart = html.indexOf('id="terminal-overlay"');
  assert.ok(overlayStart > html.indexOf('id="drawer-model"'), 'overlay markup sits after the drawer section');
}

function testAppSource() {
  const source = readRepoFile('public/app.js');
  for (const fragment of [
    'function openTerminal(id)',
    'function closeTerminal()',
    'terminalId: null',
    'appendTerminalLine',
    'href="#icon-terminal"'
  ]) {
    assertIncludes(source, fragment, `app.js contains ${fragment}`);
  }
  const addLogEntries = extractFunction(source, 'function addLogEntries(id, entries)');
  assertIncludes(addLogEntries, 'appendLogLine(entry)', 'addLogEntries keeps appendLogLine');
  assertIncludes(addLogEntries, 'appendTerminalLine(entry)', 'addLogEntries refreshes the overlay');
  assert.ok(
    addLogEntries.indexOf('appendLogLine(entry)') < addLogEntries.indexOf('appendTerminalLine(entry)'),
    'addLogEntries refreshes the overlay after appendLogLine'
  );
  const makeLogLine = extractFunction(source, 'function makeLogLine(entry)');
  assert.ok(!makeLogLine.includes('innerHTML'), 'makeLogLine must not use innerHTML');
  assertIncludes(makeLogLine, 'textContent', 'makeLogLine renders via textContent');
  const escapeHandler = source.match(/document\.addEventListener\('keydown'[\s\S]*?closePlanFileModal\(\);[\s\S]{0,600}/);
  assert.ok(escapeHandler, 'global Escape handler exists');
  assertIncludes(escapeHandler[0], 'closeTerminal()', 'Escape closes the terminal overlay');
  assertIncludes(source, 'class="card-model-row"', 'card markup wires the model row');
  assertIncludes(source, 'event.target === dom.terminalOverlay', 'backdrop click closes the overlay');
}

function testMakeLogLineSafety() {
  const { streamClass, makeLogLine } = loadLogLineFunctions();
  assertEqual(streamClass('out'), 'stdout', 'streamClass out');
  assertEqual(streamClass('err'), 'stderr', 'streamClass err');
  assertEqual(streamClass('system'), 'system', 'streamClass system');
  const entry = {
    seq: 7,
    stream: 'err',
    ts: Date.parse('2026-01-01T10:00:00Z'),
    text: '<script>alert(1)</script>\nsecond line'
  };
  const line = makeLogLine(entry);
  assertIncludes(line.className, 'log-stderr', 'stderr line class');
  assertEqual(line.dataset.seq, '7', 'line seq dataset');
  const textSpan = line.children.find((child) => child.className === 'log-text');
  assert.ok(textSpan, 'line has a text span');
  assertEqual(textSpan.textContent, entry.text, 'log text rendered literally');
  assert.ok(!('innerHTML' in textSpan) || !Object.prototype.hasOwnProperty.call(textSpan, 'innerHTML'), 'log text sets no innerHTML');
  const meta = line.children.find((child) => child.className === 'log-meta');
  assert.ok(meta && meta.textContent !== entry.text, 'meta holds the timestamp');
}

function testRenderTerminalLogsEmptyState() {
  const { dom, renderTerminalLogs } = loadRenderTerminalLogs(new Map());
  renderTerminalLogs('p1');
  assertEqual(dom.textContent, '', 'empty list cleared');
  assertEqual(dom.children.length, 1, 'one empty placeholder');
  const placeholder = dom.children[0];
  assert.ok(String(placeholder.className).includes('terminal-empty'), 'placeholder class');
  assert.ok(placeholder.textContent.length > 0, 'placeholder text set via textContent');
}

function testRenderTerminalLogsEntries() {
  const entries = [
    { seq: 1, stream: 'out', ts: Date.parse('2026-01-01T10:00:00Z'), text: 'first' },
    { seq: 2, stream: 'system', ts: Date.parse('2026-01-01T10:00:01Z'), text: 'second\nmulti' }
  ];
  const logs = new Map([['p1', { entries, seen: new Set([1, 2]) }]]);
  const { dom, renderTerminalLogs } = loadRenderTerminalLogs(logs);
  renderTerminalLogs('p1');
  assertEqual(dom.children.length, 2, 'one element per entry');
  assertEqual(dom.scrollTop, dom.scrollHeight, 'list scrolled to bottom');
}

function testAppendTerminalLineGuards() {
  const helpers = loadOverlayFunctions({ open: false, drawerId: 'p1' });
  const entry = { seq: 1, projectId: 'p1', stream: 'out', ts: 0, text: 'hello' };
  helpers.appendTerminalLine(entry);
  assertEqual(helpers.dom.terminalLogList.children.length, 0, 'closed overlay ignores entries');

  helpers.app.terminalId = 'p1';
  helpers.dom.terminalOverlay.hidden = false;
  helpers.appendTerminalLine(entry);
  assertEqual(helpers.dom.terminalLogList.children.length, 1, 'open overlay appends entry');
  helpers.appendTerminalLine(entry);
  assertEqual(helpers.dom.terminalLogList.children.length, 1, 'seq dedupe drops re-sent entries');

  const other = { seq: 2, projectId: 'p2', stream: 'out', ts: 0, text: 'other' };
  helpers.appendTerminalLine(other);
  assertEqual(helpers.dom.terminalLogList.children.length, 1, 'other project entries ignored');
}

function testAppendTerminalLineReplacesEmptyState() {
  const helpers = loadOverlayFunctions({ open: false });
  helpers.app.terminalId = 'p1';
  helpers.dom.terminalOverlay.hidden = false;
  const placeholder = makeElement();
  placeholder.className = 'terminal-empty';
  placeholder.textContent = 'No agent output yet.';
  helpers.dom.terminalLogList.appendChild(placeholder);
  const entry = { seq: 1, projectId: 'p1', stream: 'out', ts: 0, text: 'hello' };
  helpers.appendTerminalLine(entry);
  const list = helpers.dom.terminalLogList;
  assertEqual(list.children.length, 1, 'placeholder removed, log line appended');
  assert.ok(!String(list.children[0].className).includes('terminal-empty'), 'remaining node is the log line');
  assert.equal(list.children[0].dataset.seq, '1', 'appended entry dataset');
}

function testOpenAndCloseTerminal() {
  const helpers = loadOverlayFunctions({ open: false });
  helpers.openTerminal('p1');
  assertEqual(helpers.app.terminalId, 'p1', 'openTerminal sets terminalId');
  assertEqual(helpers.dom.terminalOverlay.hidden, false, 'openTerminal shows the overlay');
  assertEqual(helpers.documentStub.body.style.overflow, 'hidden', 'openTerminal locks page scroll');
  assert.deepEqual(helpers.calls.renderTerminalLogs, ['p1'], 'openTerminal renders project logs');
  assert.ok(String(helpers.dom.terminalTitle.textContent).includes('Demo'), 'openTerminal titles with project name');
  assertEqual(helpers.dom.terminalClose.focusCount, 1, 'openTerminal focuses the close button');

  helpers.openTerminal('nope');
  assertEqual(helpers.app.terminalId, 'p1', 'unknown project does not steal the overlay');

  helpers.app.drawerId = null;
  helpers.closeTerminal();
  assertEqual(helpers.app.terminalId, null, 'closeTerminal clears terminalId');
  assertEqual(helpers.dom.terminalOverlay.hidden, true, 'closeTerminal hides the overlay');
  assertEqual(helpers.documentStub.body.style.overflow, '', 'closeTerminal unlocks scroll with drawer closed');

  helpers.openTerminal('p1');
  helpers.app.drawerId = 'p1';
  helpers.closeTerminal();
  assertEqual(helpers.documentStub.body.style.overflow, 'hidden', 'drawer-open keeps scroll locked');
}

function testAddLogEntriesRefreshesOverlay() {
  const source = readRepoFile('public/app.js');
  const addLogEntries = extractFunction(source, 'function addLogEntries(id, entries)');
  const bucketFixture = { seen: new Set(), entries: [] };
  const calls = [];
  const factory = new Function('logBucket', 'appendLogLine', 'appendTerminalLine', [
    addLogEntries,
    'return addLogEntries;'
  ].join('\n'));
  const addLogEntriesFn = factory(
    () => bucketFixture,
    (entry) => calls.push(['appendLogLine', entry.seq]),
    (entry) => calls.push(['appendTerminalLine', entry.seq])
  );
  const entries = [
    { seq: 1, projectId: 'p1', stream: 'out', ts: 0, text: 'one' },
    { seq: 2, projectId: 'p1', stream: 'out', ts: 0, text: 'two' }
  ];
  addLogEntriesFn('p1', entries);
  assert.deepEqual(calls.map(([name, seq]) => `${name}:${seq}`), [
    'appendLogLine:1',
    'appendTerminalLine:1',
    'appendLogLine:2',
    'appendTerminalLine:2'
  ], 'overlay refresh follows every accepted entry');

  calls.length = 0;
  addLogEntriesFn('p1', entries);
  assertEqual(calls.length, 0, 'duplicate seqs do not replay into drawer or overlay');
}

function testStyles() {
  const css = readRepoFile('public/styles.css');
  for (const fragment of ['.terminal-overlay', '.terminal-button', '.terminal-log-list', '.terminal-empty', 'min-height: 44px', 'min-width: 44px']) {
    assertIncludes(css, fragment, `styles.css contains ${fragment}`);
  }
}

function testPackageRegistration() {
  const pkg = JSON.parse(readRepoFile('package.json'));
  const testScript = pkg.scripts && pkg.scripts.test;
  assert.ok(testScript, 'package.json has a test script');
  assertIncludes(testScript, 'scripts/test-terminal-overlay-ui.js', 'test script registers the new test');
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

async function main() {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    settings: { maxConcurrent: 1, mode: 'serial' },
    projects: []
  }, null, 2));

  testStaticMarkup();
  testAppSource();
  testStyles();
  testPackageRegistration();
  testMakeLogLineSafety();
  testRenderTerminalLogsEmptyState();
  testRenderTerminalLogsEntries();
  testAppendTerminalLineGuards();
  testAppendTerminalLineReplacesEmptyState();
  testOpenAndCloseTerminal();
  testAddLogEntriesRefreshesOverlay();

  server = spawn(process.execPath, ['server.js'], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();
    const indexHtml = await fetchAsset('/', 'GET /');
    const appSource = await fetchAsset('/app.js', 'GET /app.js');
    const cssSource = await fetchAsset('/styles.css', 'GET /styles.css');
    testStaticMarkup();
    assertIncludes(appSource, 'function openTerminal(id)', 'served app.js contains openTerminal');
    for (const fragment of ['.terminal-overlay', '.terminal-button', 'min-height: 44px', 'min-width: 44px']) {
      assertIncludes(cssSource, fragment, `served CSS contains ${fragment}`);
    }
  } finally {
    if (server && !server.killed) server.kill('SIGTERM');
    await delay(150);
    server = null;
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('test-terminal-overlay-ui: all assertions passed');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
