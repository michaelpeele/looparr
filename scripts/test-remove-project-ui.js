'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8');

const appSource = read('public', 'app.js');
const serverSource = read('server.js');
const engineSource = read('src', 'engine.js');

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

function assertExcludes(text, fragment, label) {
  assert.ok(!text.includes(fragment), `${label}: unexpected ${JSON.stringify(fragment)}`);
}

const handlerStart = appSource.indexOf('async function handleCardAction(card, action) {');
assert.notEqual(handlerStart, -1, 'handleCardAction not found');
const handlerEnd = appSource.indexOf('function updateAllCountdowns()', handlerStart);
assert.notEqual(handlerEnd, -1, 'handleCardAction end not found');
const handler = appSource.slice(handlerStart, handlerEnd);

assertIncludes(
  handler,
  'Remove ${project.name} from looparr? The project directory and plan.md will not be deleted.',
  'remove confirmation text'
);
assertIncludes(handler, "if (action === 'remove') {", 'remove branch');
assertIncludes(
  handler,
  "await api(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });",
  'DELETE project request'
);
assertIncludes(
  handler,
  "await api(`/api/projects/${encodeURIComponent(project.id)}/${action}`, { method: 'POST' });",
  'POST start/pause/stop request'
);
assertIncludes(handler, 'flashCard(card, error.message);', 'inline error handling');
assertExcludes(handler, '/remove', 'no POST path ends in /remove');
assertIncludes(appSource, 'removeButton.disabled = false;', 'remove button stays enabled');

for (const action of ['start', 'pause', 'stop']) {
  assertIncludes(appSource, `data-action="${action}"`, `card ${action} button`);
}

assertExcludes(
  appSource,
  '/api/projects/${encodeURIComponent(project.id)}/remove',
  'no explicit remove URL'
);
assert.ok(
  !/\/api\/projects\/[^`]*\/remove/.test(appSource),
  'UI source must not address /api/projects/:id/remove'
);

assertIncludes(serverSource, "app.delete('/api/projects/:id', (req, res) => {", 'server DELETE route');
assertIncludes(serverSource, 'const ok = engine.removeProject(req.params.id);', 'server remove call');
assertIncludes(
  serverSource,
  "for (const action of ['start', 'pause', 'stop']) {",
  'server action list'
);
assertIncludes(
  serverSource,
  'app.post(`/api/projects/:id/${action}`, (req, res) => {',
  'server POST action route'
);

assertIncludes(engineSource, 'function removeProject(id) {', 'engine.removeProject definition');
assertIncludes(
  engineSource,
  'config.projects = config.projects.filter((candidate) => candidate.id !== id);',
  'engine project removal'
);

const removeStart = engineSource.indexOf('function removeProject(id) {');
const removeEnd = engineSource.indexOf('function updateSettings(patch) {', removeStart);
const removeProject = engineSource.slice(removeStart, removeEnd);
assertExcludes(removeProject, 'fs.', 'no filesystem calls in removeProject');
assertExcludes(removeProject, 'unlink', 'no file unlink in removeProject');
assertExcludes(removeProject, 'rm(', 'no filesystem removal in removeProject');

console.log('remove-project UI smoke tests passed');
