'use strict';

const assert = require('node:assert/strict');
const widget = require('../src/widget-payload');

const NOW = 1795400000000;

function project(overrides = {}) {
  return {
    id: 'looparr',
    name: 'Looparr',
    path: '/projects/looparr',
    status: 'idle',
    active: false,
    paused: false,
    currentTask: '',
    nextTask: '',
    activeRunner: '',
    activeModel: '',
    runner: 'opencode',
    effectiveRunners: 'opencode,kilo',
    effectiveModel: 'opencode/tidepool-alpha-free',
    progress: { completed: 0, total: 0 },
    iconVersion: 'v1',
    resumeAt: null,
    error: '',
    ...overrides
  };
}

// Status labels and colors are server-owned so the installed widget follows
// dashboard changes. These are the values the card renders.
assert.deepEqual(
  widget.statusStyle(project({ status: 'rateLimited' })),
  { label: 'Rate Limited', bg: '#3B1D1D', text: '#FCA5A5', dot: '#F87171' },
  'rate-limited style'
);
assert.equal(widget.statusStyle(project({ status: 'implement' })).label, 'Implement', 'implement label');
assert.equal(widget.statusStyle(project({ status: 'mystery' })).label, 'mystery', 'unknown status label');

// A missing plan.md still reads as setup needed, not as a red error.
const missingPlan = project({ error: 'plan.md: ENOENT' });
assert.equal(widget.isPlanSetup(missingPlan), true, 'plan setup detected');
assert.equal(widget.statusStyle(missingPlan).label, 'Setup Needed', 'setup label wins');
assert.equal(widget.buildCard(missingPlan, NOW).error, '', 'setup error is not shown as a failure');

// The runner line sits under the current task, so an active step wins over the
// configured list.
assert.equal(
  widget.runnerModelText(project({ activeRunner: 'kilo', activeModel: 'kilo/baidu/ernie-5.5-flash-preview:free' })),
  'kilo · kilo/baidu/ernie-5.5-flash-preview:free',
  'active runner/model'
);
assert.equal(widget.runnerModelText(project()), 'opencode · opencode/tidepool-alpha-free', 'idle fallback');
assert.equal(
  widget.runnerModelText(project({ runner: '' })),
  'opencode + kilo · opencode/tidepool-alpha-free',
  'configured runner list joins'
);
assert.equal(widget.runnerModelText(project({ runner: '', effectiveRunners: '', effectiveModel: '' })), '', 'empty line');

// Project resolution for the widget parameter, and the default selection order.
const running = project({ id: 'running', name: 'Running', path: '/projects/running', status: 'implement', active: true });
const limited = project({ id: 'limited', name: 'Limited', path: '/projects/limited', status: 'rateLimited' });
const idle = project({ id: 'idle', name: 'Idle', path: '/projects/idle' });

assert.equal(widget.findProject([idle, limited], 'LIMITED').id, 'limited', 'match is case-insensitive');
assert.equal(widget.findProject([idle], '/projects/idle/').id, 'idle', 'trailing slash tolerated');
assert.equal(widget.findProject([idle], 'missing'), null, 'unknown project is null');
assert.equal(widget.pickProject([idle, limited, running]).id, 'running', 'running wins by default');
assert.equal(widget.pickProject([idle, limited]).id, 'limited', 'then rate-limited');
assert.equal(widget.pickProject([idle]).id, 'idle', 'then first');

// The countdown is server-computed from resumeAt so phone clock skew is moot.
const paused = project({
  status: 'rateLimited',
  resumeAt: NOW + 271500,
  progress: { completed: 4, total: 9 }
});
const pausedCard = widget.buildCard(paused, NOW);
assert.equal(pausedCard.retryInSeconds, 272, 'retry seconds round up');
assert.equal(pausedCard.resumeAt, NOW + 271500, 'resumeAt passed through');
assert.deepEqual(pausedCard.progress, { completed: 4, total: 9 }, 'progress passed through');
assert.equal(widget.buildCard(project(), NOW).resumeAt, 0, 'no countdown when not rate-limited');

const payload = widget.buildPayload([idle, limited], { project: 'limited', now: NOW });
assert.equal(payload.ok, true, 'payload ok');
assert.equal(payload.choose, false, 'chosen card');
assert.equal(payload.project.id, 'limited', 'requested project');
assert.equal(payload.projects.length, 2, 'project list for the picker');
assert.equal(payload.projects[1].label, 'Rate Limited', 'project list labels');
assert.equal(payload.project.iconPath, '/api/projects/limited/icon.png', 'icon path');

const empty = widget.buildPayload([], { now: NOW });
assert.equal(empty.project, null, 'no projects renders the choose view');
assert.equal(empty.choose, true, 'choose flag');

const unknown = widget.buildPayload([idle], { project: 'nope', now: NOW });
assert.equal(unknown.project, null, 'unknown parameter selects nothing');

console.log('widget payload: status, runner, selection and retry fields.');
