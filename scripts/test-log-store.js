'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Temp dir, not the repo root: the container image runs as uid 1000 and /app is
// read-only for it, so the test has to run there too.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'looparr-log-store-'));
const LOG_DIR = path.join(DIR, 'logs');
process.env.LOOPARR_LOG_DIR = LOG_DIR;
process.env.LOOPARR_LOG_MAX_BYTES = '512';
process.env.LOOPARR_LOG_RETENTION_DAYS = '7';

// Case 7 expects the one-shot "[looparr] log write failed" console.error; hush it.
const origConsoleError = console.error;
console.error = () => {};

function freshStore(env = {}) {
  delete require.cache[require.resolve('../src/log-store')];
  for (const [key, value] of Object.entries(env)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
  return require('../src/log-store');
}

function logFiles(projId) {
  return fs.readdirSync(path.join(LOG_DIR, projId)).filter(f => f.endsWith('.log')).sort();
}

const TS_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}(-\d+)?\.log$/;

let store = freshStore();
const PROJECT = 'proj-alpha';

// ── Case 1: entries land as NDJSON in one timestamped file, mode 0600 ──
for (let i = 1; i <= 3; i += 1) {
  store.append(PROJECT, { seq: i, ts: Date.now(), stream: 'out', text: `line ${i}` });
}

const projDir = path.join(LOG_DIR, PROJECT);
const files1 = logFiles(PROJECT);
assert.equal(files1.length, 1, 'case 1: one timestamped file holds the first entries');
assert.match(files1[0], TS_NAME, 'case 1: filename is a timestamp');
assert.match(files1[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.log$/, 'case 1: no collision suffix on the first file');
const mode1 = fs.statSync(path.join(projDir, files1[0])).mode & 0o777;
assert.equal(mode1, 0o600, 'case 1: file mode is 0600');
const lines1 = fs.readFileSync(path.join(projDir, files1[0]), 'utf8').trim().split('\n');
assert.equal(lines1.length, 3, 'case 1: one NDJSON line per entry');
const parsed1 = lines1.map(l => JSON.parse(l));
assert.deepEqual(parsed1.map(e => e.seq), [1, 2, 3], 'case 1: seq preserved');
assert.deepEqual(parsed1.map(e => e.text), ['line 1', 'line 2', 'line 3'], 'case 1: text preserved');
assert.ok(parsed1.every(e => typeof e.ts === 'number' && e.stream === 'out'), 'case 1: ts and stream preserved');

// ── Case 2: writing past the cap creates a second file, nothing lost ──
for (let i = 4; i <= 40; i += 1) {
  store.append(PROJECT, { seq: i, ts: Date.now(), stream: 'out', text: `filler ${i} ${'x'.repeat(40)}` });
}

const files2 = logFiles(PROJECT);
assert.ok(files2.length >= 2, 'case 2: rotation created at least a second file');
assert.deepEqual(files2, [...files2].sort(), 'case 2: file names sort chronologically');
const sizes2 = files2.map(f => fs.statSync(path.join(projDir, f)).size);
const oneLineOverhead = Buffer.byteLength(JSON.stringify({ seq: 0, ts: 0, stream: 'out', text: '' }) + '\n', 'utf8');
assert.ok(sizes2.slice(0, -1).every(s => s <= 512 + oneLineOverhead),
  'case 2: every closed file is at most the cap (plus the one line that crossed it)');
const allLines = files2.flatMap(f => fs.readFileSync(path.join(projDir, f), 'utf8').trim().split('\n').filter(Boolean));
assert.equal(allLines.length, 40, 'case 2: no entry is lost across rotation');

// ── Case 3: two rotations in the same millisecond get -2/-3, not overwrite ──
const SPRINT = 'proj-sprint';
for (let i = 1; i <= 4; i += 1) {
  store.append(SPRINT, { seq: 100 + i, ts: Date.now(), stream: 'out', text: 'z'.repeat(200) });
}
const sprintFiles = logFiles(SPRINT);
assert.ok(sprintFiles.length >= 2, 'case 3: 4 large entries against a 512 cap rotate');
assert.ok(sprintFiles.every(f => TS_NAME.test(f)), 'case 3: every rotated file keeps the timestamp naming scheme');

// Force the collision path directly through fileFor.
const collisionAt = new Date(9999, 0, 1, 0, 0, 0, 0).getTime();
fs.writeFileSync(path.join(LOG_DIR, SPRINT, '9999-01-01T00-00-00-000.log'), 'x', { mode: 0o600 });
fs.writeFileSync(path.join(LOG_DIR, SPRINT, '9999-01-01T00-00-00-000-2.log'), 'x', { mode: 0o600 });
const third = store.fileFor(SPRINT, collisionAt);
assert.equal(path.basename(third), '9999-01-01T00-00-00-000-3.log', 'case 3: third same-ms file gets -3');
fs.rmSync(path.join(LOG_DIR, SPRINT, '9999-01-01T00-00-00-000.log'), { force: true });
fs.rmSync(path.join(LOG_DIR, SPRINT, '9999-01-01T00-00-00-000-2.log'), { force: true });
fs.rmSync(third, { force: true });
// Fresh store: the appends resume from the remaining files under the cap.
store = freshStore();
store.append(SPRINT, { seq: 999, ts: Date.now(), stream: 'out', text: 'after collision' });
assert.ok(store.readRecent(SPRINT, 10).some(e => e.seq === 999),
  'case 3: appends after the collision resume on the surviving record');

// ── Case 4: old files pruned by mtime, active file never deleted ──
store = freshStore();
const PRUNE = 'proj-prune';
const pruneDir = path.join(LOG_DIR, PRUNE);
const now = Date.now();
// Create the active file through normal use so the record is in the module map.
store.append(PRUNE, { seq: 1, ts: now, stream: 'out', text: 'active' });
const activeFile = path.join(pruneDir, logFiles(PRUNE)[0]);
// Seed an 8-day-old file, a 2-day-old file, then backdate the active file.
const oldPath = path.join(pruneDir, '2026-01-01T00-00-00-000.log');
fs.writeFileSync(oldPath, JSON.stringify({ seq: 2, ts: now, stream: 'out', text: 'old' }) + '\n', { mode: 0o600 });
fs.utimesSync(oldPath, new Date(now - 8 * 86_400_000), new Date(now - 8 * 86_400_000));
const midPath = path.join(pruneDir, '2026-01-02T00-00-00-000.log');
fs.writeFileSync(midPath, JSON.stringify({ seq: 3, ts: now, stream: 'out', text: 'recent' }) + '\n', { mode: 0o600 });
fs.utimesSync(midPath, new Date(now - 2 * 86_400_000), new Date(now - 2 * 86_400_000));
fs.utimesSync(activeFile, new Date(now - 8 * 86_400_000), new Date(now - 8 * 86_400_000));
store.prune(); // fresh module: throttle timestamp is 0, so this runs
assert.ok(!fs.existsSync(oldPath), 'case 4: 8-day-old file pruned');
assert.ok(fs.existsSync(midPath), 'case 4: 2-day-old file survives');
assert.ok(fs.existsSync(activeFile), 'case 4: active file survives even with an old mtime');
const remainingAfterPrune = logFiles(PRUNE);
assert.deepEqual(remainingAfterPrune, [path.basename(midPath), path.basename(activeFile)],
  'case 4: prune removes exactly the expired file');
assert.doesNotThrow(() => store.prune(), 'case 4: prune is safe to call repeatedly');

// ── Case 5: readRecent returns the newest entries in order after restart ──
// Bigger cap for this case so all entries share one file, like a real week
// against the 10 MiB production cap.
store = freshStore({ LOOPARR_LOG_MAX_BYTES: String(10 * 1024 * 1024) });
const LIMITP = 'proj-limit';
for (let i = 1; i <= 410; i += 1) {
  store.append(LIMITP, { seq: 5000 + i, ts: now, stream: 'out', text: `entry ${i}` });
}
const reloaded = freshStore({ LOOPARR_LOG_MAX_BYTES: String(10 * 1024 * 1024) }); // simulated restart
const recent = reloaded.readRecent(LIMITP, 400);
assert.equal(recent.length, 400, 'case 5: hydration returns the last 400 entries');
assert.deepEqual(recent.map(e => e.seq), Array.from({ length: 400 }, (_, i) => 5011 + i),
  'case 5: entries are the newest ones in original order');
const maxSeq = Math.max(...recent.map(e => e.seq));
assert.equal(maxSeq, 5410, 'case 5: logSeq continues from the highest hydrated seq');
reloaded.append(LIMITP, { seq: maxSeq + 1, ts: now, stream: 'out', text: 'post-restart' });
const recent2 = reloaded.readRecent(LIMITP, 400);
assert.equal(recent2[recent2.length - 1].seq, maxSeq + 1, 'case 5: post-restart append continues the seq chain');
assert.equal(recent2.length, 400, 'case 5: buffer stays at the limit after restart');

// ── Case 6: a corrupt trailing line is skipped without throwing ──
store = freshStore({ LOOPARR_LOG_MAX_BYTES: String(10 * 1024 * 1024) });
const CORRUPT = 'proj-corrupt';
store.append(CORRUPT, { seq: 1, ts: now, stream: 'out', text: 'good entry' });
const corruptFile = path.join(LOG_DIR, CORRUPT, logFiles(CORRUPT)[0]);
fs.appendFileSync(corruptFile, '{"seq":2,"ts":123,"stream":"out","text":"partial trun', 'utf8');
const reloaded2 = freshStore({ LOOPARR_LOG_MAX_BYTES: String(10 * 1024 * 1024) });
const recovered = reloaded2.readRecent(CORRUPT, 400);
assert.equal(recovered.length, 1, 'case 6: corrupt trailing line skipped');
assert.equal(recovered[0].seq, 1, 'case 6: good entry survives');
assert.equal(recovered[0].text, 'good entry', 'case 6: good entry intact');

// ── Case 7: an unwritable log dir must not make the caller throw ──
// Point the module at a path that cannot be a directory: an existing file.
const blocker = path.join(DIR, 'blocker-file');
fs.writeFileSync(blocker, 'not a dir', { mode: 0o600 });
const badStore = freshStore({ LOOPARR_LOG_DIR: blocker });
badStore.closeAll();
let logged = 0;
console.error = (msg) => {
  if (String(msg).includes('[looparr] log write failed for project proj-broken')) logged += 1;
};
assert.doesNotThrow(() => {
  badStore.append('proj-broken', { seq: 1, ts: now, stream: 'out', text: 'must not throw' });
  badStore.append('proj-broken', { seq: 2, ts: now, stream: 'out', text: 'still must not throw' });
}, 'case 7: append never throws on an unwritable log dir');
assert.equal(logged, 1, 'case 7: the write error is logged exactly once per project');
console.error = origConsoleError;

badStore.closeAll();
fs.rmSync(DIR, { recursive: true, force: true });
console.log('log store: NDJSON persistence, 0600 mode, size rotation, collision suffixes, mtime prune, hydration, corrupt-line resilience, and error containment all pass.');
