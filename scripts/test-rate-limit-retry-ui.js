'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const appPath = path.join(REPO_ROOT, 'public', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

function assertExcludes(text, fragment, label) {
  assert.ok(!text.includes(fragment), `${label}: unexpected ${JSON.stringify(fragment)}`);
}

assertIncludes(source, "function startActionLabel(project) {", 'startActionLabel helper');
assertIncludes(source, "return project.status === 'rateLimited' ? 'Retry' : 'Start';", 'rateLimited Retry label');
assertIncludes(source, "const rateLimited = project.status === 'rateLimited';", 'controlDisabled rateLimited flag');
assertIncludes(source, "const waiting = project.status === 'waitingAnswer' || project.status === 'waitingConfirm';", 'controlDisabled waiting flag');
assertIncludes(source, "start: !(rateLimited || waiting) && ((project.active && !project.paused) || (project.status === 'done' && !hasPending)),", 'rateLimited start exception');
assertIncludes(source, "startButton.title = startLabel;", 'card button sets title from startActionLabel');
assertIncludes(source, "startButton.setAttribute('aria-label', startLabel);", 'card button sets aria-label from startActionLabel');
assertIncludes(source, "const startLabel = startActionLabel(project);", 'card derives start label');
assertIncludes(source, "Rate limit backoff active. Auto-retry pending; press Retry to start immediately.", 'rateLimited helper text');
assertExcludes(source, "Waiting for rate limit window.", 'old rate limit helper text');
assertExcludes(source, '/api/projects/${encodeURIComponent(project.id)}/retry', 'no retry route');
assertExcludes(source, '↻', 'no circular arrow glyph');

const cardLabelCount = (source.match(/buttons\[0\]\.textContent = startActionLabel\(project\);/g) || []).length;
assert.equal(cardLabelCount, 1, 'only the drawer should set start label via textContent');

console.log('rate-limit retry UI smoke tests passed');
