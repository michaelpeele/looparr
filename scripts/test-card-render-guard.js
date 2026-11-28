'use strict';

// Regression guard for the home-grid card regression: `updateCard` looked card
// controls up with `buttons.querySelector(...)` while `buttons` was a
// `querySelectorAll` NodeList, so the first card threw and every card after it
// never rendered (only the first project showed). A single faulty card must
// also never blank the rest of the grid.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

// The previous implementation, kept as a behavioural proof of the regression:
// a NodeList has no querySelector, an array plus find does.
const controls = [{ dataset: { action: 'start' } }, { dataset: { action: 'remove' } }];
assert.throws(
  () => controls.querySelector('[data-action="start"]'),
  /querySelector is not a function/,
  'NodeList/array lookup throws exactly like the regression'
);
const byAction = (action) => controls.find((button) => button.dataset.action === action);
assert.equal(byAction('start').dataset.action, 'start', 'find resolves the start control');
assert.equal(byAction('remove').dataset.action, 'remove', 'find resolves the remove control');

assert.ok(
  APP.includes("const buttons = [...card.querySelectorAll('.card-controls button')];"),
  'card controls are an array, not a NodeList'
);
assert.ok(
  APP.includes('const byAction = (action) => buttons.find((button) => button.dataset.action === action);'),
  'card control lookup uses find'
);
assert.ok(!APP.includes('buttons.querySelector'), 'no NodeList querySelector lookup remains');

assert.ok(APP.includes('const cardErrorSeen = new Set();'), 'card render errors are deduped');
assert.ok(
  APP.includes('reportCardError(project.id, error);'),
  'renderCards isolates a card failure'
);
assert.ok(
  /function renderCards\(projects\) \{[\s\S]*?try \{[\s\S]*?updateCard\(card, project\);[\s\S]*?catch \(error\) \{\s*reportCardError\(project\.id, error\);/.test(APP),
  'updateCard runs inside a per-card try/catch'
);

console.log('card render guard: control lookup and per-card isolation verified.');
