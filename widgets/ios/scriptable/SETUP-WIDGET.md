# Looparr Scriptable widgets

Two widgets live here. Both read from a running Looparr instance; neither
contains the card layout rules that change most often.

| File | What it is |
| --- | --- |
| `looparr-meta-widget.js` | **Recommended.** Thin client: fetches `GET /api/widget` and renders whatever card the server describes. |
| `looparr-widget.js` | Standalone v8 widget. Keeps its own status/color map and reads `/api/state`; use it if you want a script that does not depend on the payload route. |

## Endpoint

```
GET /api/widget                    # default card
GET /api/widget?project=<id|name|path>
```

`/api/widget` returns `Cache-Control: no-store` JSON:

```json
{
  "ok": true,
  "updatedAt": "2026-11-23T12:00:00.000Z",
  "choose": false,
  "project": {
    "id": "looparr",
    "name": "looparr",
    "path": "/home/me/ai-projects/looparr",
    "status": "rateLimited",
    "badge": { "label": "Rate Limited", "bg": "#3B1D1D", "text": "#FCA5A5", "dot": "#F87171" },
    "currentTask": "Fix the retry path",
    "nextTask": "Verify failover",
    "error": "",
    "runner": { "text": "opencode · big-pickle", "active": true },
    "progress": { "completed": 4, "total": 9 },
    "active": true,
    "paused": false,
    "resumeAt": 1795402950538,
    "retryInSeconds": 271,
    "iconPath": "/api/projects/looparr/icon.png",
    "iconVersion": "a1b2c3",
    "href": "/"
  },
  "projects": [
    { "id": "looparr", "name": "looparr", "path": "/home/me/ai-projects/looparr", "status": "rateLimited", "label": "Rate Limited" }
  ]
}
```

Rules worth knowing:

- **Default selection:** the running project, then a rate-limited one, then the
  first project. An unknown `?project=` answers `404 {"ok":false,...}`.
- **Labels and colors are server-owned.** Editing `STATUS_STYLES` in
  `src/widget-payload.js` changes the widget on the next refresh; nothing is
  re-copied to the phone.
- **`retryInSeconds` is computed on the server**, so device clock skew does not
  affect the countdown.
- **`runner.active`** is true only while a model is actually running a step,
  which is what colors the runner dot.
- The payload carries no secrets and no settings; it is safe to expose wherever
  the dashboard is reachable.

## Install (iOS)

1. Copy `looparr-meta-widget.js` into Scriptable (share sheet → Copy, or paste
   into a new script named `looparr-meta-widget`).
2. Set `BASE_URL` at the top. The default is the Tailscale hostname
   (`https://looparr.tail0307d.ts.net`); use `http://<host>:<port>` on a plain
   LAN or tunnel.
3. Add a Scriptable widget to the home screen and choose this script.
4. Optional: set **Widget Parameter** to a project id, name, or full path. Leave
   it empty to follow whichever project is running.
5. Run the script inside Scriptable once. In-app, non-widget runs open the
   dashboard instead of building a card.

Changing `BASE_URL` and the parameter are the only edits the meta-widget needs.
Everything else — status text, colors, retry countdown, runner line, progress —
comes from the server.

## Offline behavior

The last good payload is cached at `Documents/looparr-meta-widget.json` in
Scriptable's local container (created by the first successful fetch; the script
checks `fileExists` before reading, so a fresh install does not raise a
missing-file error). When the request fails, the cached card renders with an
**Offline** marker; with no cache it falls back to a short "server unreachable"
view.

## Adding a field

1. Add it in `buildCard()` (`src/widget-payload.js`).
2. Render it in `looparr-meta-widget.js` **only if** it is a new visual block.
   New text inside existing blocks needs no script change.
3. Run `node scripts/test-widget-payload.js` and `npm test`, then
   `npm run restart:looparr` so the container serves the new payload.

## Quick check

```bash
# against the local sandbox or the running instance
curl -fsS http://127.0.0.1:4188/api/widget | head -c 600
curl -fsS 'http://127.0.0.1:4188/api/widget?project=looparr' | head -c 600
```

In Scriptable, `Request(...).loadJSON()` throws on non-2xx, which is why an
unknown project parameter shows the offline/cached card rather than an empty one.
