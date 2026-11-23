# Log files with size rotation — implementation prompt

Status: not started. Plan item: `(plan) Log files with size rotation`.

## Goal

Persist the UI log buffer to disk so a container restart no longer wipes history, with a
10 MiB cap per project file, timestamped file names, and 7-day age-out by mtime.

## Current behaviour (verified)

- `src/engine.js` `appendLog()` (lines 138–149) pushes `{ seq, ts, stream, text }` onto `rt.logs`,
  caps the buffer at `LOG_LIMIT = 400` (line 20), and emits the entry on the SSE bus. Nothing is
  written to disk.
- `getState()` returns `logs: rt.logs.slice(-200)` per project (line ~227), which is the only
  history the drawer sees.
- `src/auto-resume.js` is the only file that writes a log today: `.looparr/auto-resume.log`,
  capped at 64 KiB with one `.log.1` rotation (lines 8, 66–74), written with
  `fs.appendFileSync(..., { mode: 0o600 })`. It is a separate audit log and stays unchanged.
- Production mounts `./data:/app/data` and sets `CONFIG_PATH=/app/data/config.json`
  (`docker-compose.yml`), so `data/logs/` persists across rebuilds. `.gitignore` already ignores
  `data/*` (with `.gitkeep` re-included).

## Requirements

1. Every entry `appendLog()` produces is appended to disk as one NDJSON line:
   `{"seq":123,"ts":1795393501497,"stream":"out","text":"..."}\n`.
2. One directory per project, one file per 10 MiB segment:
   `data/logs/<projectId>/2026-11-23T01-14-02-123.log`
   - Timestamp at creation, local time, `YYYY-MM-DDTHH-mm-ss-SSS` (no `:`, lexically sortable).
   - Rotation is **size only**: when the next line would push the active file past the cap, close it
     and open a new timestamped file. Time never forces a new file.
   - Same-millisecond collision gets `-2`, `-3`, … before `.log`.
3. Cap scope: **10 MiB per project** (agreed). A noisy project cannot starve the others. No global
   budget in this batch; the format allows adding one later.
4. Retention: files older than **7 days by mtime** are deleted. A file that keeps receiving writes
   stays alive. Prune at startup and at most once per hour afterwards; remove project directories
   that become empty; never delete the currently open file.
5. Hydration: on engine start `ensureRuntime()` loads the newest file's last `LOG_LIMIT` (400) entries
   into `rt.logs`, sets `logSeq` to the highest hydrated `seq`, and appends to that file if it is
   still under the cap. `/api/state` keeps `slice(-200)`; no API change.
6. A log write must never break a run: catch errors, `console.error` once per project, continue.

## Constants

```js
const LOG_DIR = process.env.LOOPARR_LOG_DIR
  || path.join(path.dirname(configStore.CONFIG_PATH), 'logs');     // data/logs in prod
const LOG_MAX_BYTES = Number(process.env.LOOPARR_LOG_MAX_BYTES) || 10 * 1024 * 1024; // 10 MiB
const LOG_RETENTION_MS = (Number(process.env.LOOPARR_LOG_RETENTION_DAYS) || 7) * 86_400_000;
```

10 MiB per project is deliberate: a step log is roughly 10–100 KB, so a file holds about 100–1,000
steps and a busy week stays in single-digit files.

## Implementation

### New `src/log-store.js`

- `logDir()`, `fileFor(projectId, at)`, `append(projectId, entry)`, `readRecent(projectId, limit)`,
  `prune()`, `closeAll()`.
- Keep a per-project record `{ path, bytes }` so the cap check does not `stat` on every line. On first
  use after a restart, `stat` the newest existing file; if it is at or over the cap, start a new one.
- Rotation decision:

  ```js
  const line = JSON.stringify(entry) + '\n';
  const size = Buffer.byteLength(line, 'utf8');
  if (rec.bytes + size > LOG_MAX_BYTES) rec = openNewFile(projectId);
  fs.appendFileSync(rec.path, line, { encoding: 'utf8', flag: 'a', mode: 0o600 });
  rec.bytes += size;
  ```

  `fs.appendFileSync` matches the existing audit-log precedent and volumes here are small. If a
  project ever floods output, switch to one `fs.createWriteStream(path, { flags: 'a' })` per project,
  ended on rotation and in `closeAll()`.
- `mkdirSync(dir, { recursive: true })` before writes; container runs as uid 1000 and `./data` is the
  writable mount.
- `readRecent()`: read the newest file (≤10 MiB), split lines, `JSON.parse` defensively (skip corrupt
  or partial trailing lines), return the last `limit` entries with original `seq`/`ts`/`stream`/`text`.
- `prune()`: for each project dir, delete `*.log` with `mtimeMs < now - LOG_RETENTION_MS`, then remove
  empty dirs; throttle with a module-level timestamp.

### Wiring

- `src/engine.js` `appendLog()`: call `logStore.append(projectId, entry)` after the memory push and
  `bus.emit('log', ...)`.
- `ensureRuntime()`: hydrate `rt.logs = logStore.readRecent(project.id, LOG_LIMIT)` and
  `logSeq = Math.max(logSeq, ...entries.map(e => e.seq))`.
- `init()`: `logStore.prune()` once; `shutdown()`: `logStore.closeAll()`.
- Add `data/logs/` to `.gitignore` explicitly for clarity (already covered by `data/*`).

## Tests — new `scripts/test-log-store.js`, added to `npm test`

Use `LOOPARR_LOG_DIR` and `LOOPARR_LOG_MAX_BYTES=512` in a temp dir:

1. Entries land as NDJSON in one timestamped file, one entry per line, mode `0600`.
2. Writing past the cap creates a second timestamped file; the first is at most the cap and no entry
   is lost; file names sort chronologically.
3. Two rotations in the same millisecond get `-2`/`-3`, not overwrite.
4. A file with an 8-day-old mtime is pruned; a 2-day-old file survives; the active file survives even
   with an old mtime.
5. `readRecent(projectId, 400)` returns the newest entries in order after a simulated restart and
   `logSeq` continues from the highest `seq`.
6. A corrupt trailing line is skipped on hydration without throwing.
7. An unwritable log dir does not make `appendLog` throw.

## Verification

1. `npm test` exit 0 and `git diff --check` clean.
2. Rebuild and recreate prod (`docker compose build looparr && docker compose up -d looparr`), confirm
   healthy on the new image and `/api/state` 200.
3. A real step creates `data/logs/<projectId>/<timestamp>.log` whose lines match the drawer.
4. Force >10 MiB of output in a throwaway project and confirm a second timestamped file appears.
5. `docker compose restart looparr` → drawer still lists history and new lines append to the newest file.
6. Seed an 8-day-old file and confirm the prune removes it while the active file survives.
7. Container source hashes match local; served assets unchanged unless UI text was touched.
