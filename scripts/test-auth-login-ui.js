'use strict';

// Source-wiring test for the client sign-in card (plan 03, step 9).
// Reads the served files and asserts the card contract without a browser:
// placement above the grid, hidden by default, escaped names, https-only link,
// no executor token in the browser bundle, polling that stops, and the exact
// Kilo hint and method label wired through.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(REPO_ROOT, 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
const authFailures = fs.readFileSync(path.join(REPO_ROOT, 'src', 'auth-failures.js'), 'utf8');

function assertIncludes(text, fragment, label) {
  assert.ok(text.includes(fragment), `${label}: missing ${JSON.stringify(fragment)}`);
}

function assertExcludes(text, fragment, label) {
  assert.ok(!text.includes(fragment), `${label}: unexpected ${JSON.stringify(fragment)}`);
}

// Card sits directly above the project grid and is hidden by default.
const cardAt = html.indexOf('id="auth-card"');
const gridAt = html.indexOf('id="project-grid"');
assert.ok(cardAt !== -1, 'index.html: auth-card section missing');
assert.ok(gridAt !== -1, 'index.html: project-grid missing');
assert.ok(cardAt < gridAt, 'index.html: auth-card must sit above project-grid');
const cardTag = html.slice(cardAt, gridAt);
assertIncludes(cardTag, 'hidden', 'auth-card hidden by default');

// Friendly name, red badge, escaped interpolations.
assertIncludes(app, 'AUTH REQUIRED · 401', 'auth badge text');
assertIncludes(app, 'const name = esc(', 'client name escaped');
assertIncludes(app, 'esc(entry.runnerId)', 'runner id escaped');
assertIncludes(app, 'esc(session.code)', 'code escaped');
assertIncludes(app, 'esc(logText)', 'log escaped');

// Live session states.
assertIncludes(app, 'Generating code…', 'generating code label');
assertIncludes(app, 'Waiting for authorization…', 'waiting label');
assertIncludes(app, 'Open Kilo sign-in', 'sign-in link label');
assertIncludes(app, 'target="_blank"', 'sign-in link new tab');
assertIncludes(app, 'rel="noopener noreferrer"', 'sign-in link rel');
assertIncludes(app, "const AUTH_URL_PREFIX = 'https://app.kilo.ai/';", 'https-only url prefix');
assertIncludes(app, 'url.startsWith(AUTH_URL_PREFIX)', 'https-only url guard');

// Exact Kilo hint (server-side store) and method label wired through the card.
assertIncludes(
  authFailures,
  'Open CLI and /models, pick Kilo gateway and reauthenticate.',
  'exact Kilo hint'
);
assertIncludes(app, 'entry.hint', 'card renders server hint');
assertIncludes(app, 'Kilo Gateway (Device Authorization)', 'exact method label');
assertIncludes(app, 'data-auth-method=', 'method label rendered on card');

// Polling starts only while active and stops on terminal states.
assertIncludes(app, 'setInterval(() => pollAuthStatus(runner)', 'poll loop starts');
assertIncludes(app, 'clearInterval(app.auth.pollTimer)', 'poll loop stops');
assertIncludes(app, "body.state === 'authorized'", 'authorized handled');
assertIncludes(app, "body.state === 'failed'", 'failed handled');
assertIncludes(app, "body.state === 'idle'", 'idle handled');
assertIncludes(app, 'stopAuthPolling();', 'stop helper used');

// The browser bundle must never carry the executor token.
assertExcludes(app, 'LOOPARR_EXECUTOR_TOKEN', 'no executor token in app.js');
assertExcludes(html, 'LOOPARR_EXECUTOR_TOKEN', 'no executor token in index.html');

// Server proxies add the token server-side and expose the expected routes.
assertIncludes(server, "app.get('/api/auth/clients'", 'clients route');
assertIncludes(server, "app.post('/api/auth/:runner/login'", 'login route');
assertIncludes(server, "app.get('/api/auth/:runner/status'", 'status route');
assertIncludes(server, "app.post('/api/auth/:runner/cancel'", 'cancel route');
assertIncludes(server, 'authorization: `Bearer ${token}`', 'server adds executor token');
assertIncludes(server, "'Host executor is not configured (LOOPARR_EXECUTOR_TOKEN missing)'", '503 when unconfigured');

console.log('auth login UI smoke tests passed');