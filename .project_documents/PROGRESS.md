# looparr deployment progress

Date: 2026-11-21

## Scope

Host the existing Looparr dashboard at `https://looparr.tail0307d.ts.net/` using the same Tailscale sidecar pattern as Curatarr and Splitarr.

Confirmed decisions:

- Tailnet-only Serve now; no Funnel until explicitly approved.
- AI execution stays on the host; no `opencode` binary or auth in the app image.
- Mount `/home/michaelpeele/ai-projects` read-write at the same absolute path.
- Local git only, branch `master`, no remote, no push.
- Do not publish `TS_AUTHKEY`.

## Implementation summary

- Added `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `serve.json`, `.env.example`.
- Added host executor at `scripts/host-executor.js` and bridge client at `scripts/bridge-client.js`.
- Added `executor` npm script.
- Added `CONFIG_PATH` override in `src/config.js`; app config persists at `/app/data/config.json`.
- Added bridge mode to `src/runners/opencode.js`; local runner behavior unchanged when `LOOPARR_EXECUTOR_URL` is unset.
- Added `AGENTS.md` pointer to `../workflow.md`.
- Updated `README.md` with hosted setup, persistence, mount details, bridge setup, verification, and future Funnel warning.
- Added `.project_documents/RESEARCH-deployment.md`.

## Verification results

### Static and build checks

- `docker compose config --quiet`: passed.
- `docker compose build`: passed.
- Final image `looparr:latest` includes `scripts/bridge-client.js`.

### Isolated smoke tests

- Ran `looparr-smoke` without Tailscale on host port `4189`.
- `curl -fsS http://127.0.0.1:4189/api/state`: returned default settings and `projects: []`.
- SSE check on `http://127.0.0.1:4189/api/events`:
  - `HTTP/1.1 200 OK`
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `retry: 3000`
  - initial `event: state` with JSON data
- Fake-binary host bridge smoke on Docker gateway port `4190`: `/health` OK; `/run` streamed fake stdout/stderr and exited 0.
- Container bridge smoke `looparr-smoke-bridge` on host port `4191` with host-gateway access: bridge client streamed fake stdout/stderr and exited 0.
- Smoke containers and smoke executor were removed.

### Production checks

- Stack after promotion:
  - `looparr`: Up, healthy.
  - `ts-looparr`: Up.
  - Host port mapping: `0.0.0.0:4188->3000/tcp`.
- App and sidecar share network namespace: both report `net:[4026534676]`.
- `curl -fsS http://127.0.0.1:4188/api/state`: returned bridge runner description `Host-side opencode executor via HTTP bridge; fresh opencode run per step.`
- Local SSE check on `http://127.0.0.1:4188/api/events`:
  - `HTTP/2 200` through proxy / `HTTP/1.1 200 OK` direct.
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
  - `retry: 3000`
  - initial `event: state` with JSON data
  - `curl` timeout after 3s is expected for an open SSE stream.
- Host executor health on Docker gateway port `4187`:
  - `{"ok":true,"projectsRoot":"/home/michaelpeele/ai-projects","opencodeBin":"/home/michaelpeele/.opencode/bin/opencode"}`
- `docker exec ts-looparr tailscale serve status`:
  - `https://looparr.tail0307d.ts.net (tailnet only)`
  - `|-- / proxy http://127.0.0.1:3000`
- `docker exec ts-looparr tailscale funnel status`: no Funnel for looparr; output matches Serve status and shows `(tailnet only)`.
- `tailscale status` shows peer `looparr` at `100.64.214.29`.
- `dig +short looparr.tail0307d.ts.net @100.100.100.100`: `100.64.214.29`.
- Plain host `curl -fsS https://looparr.tail0307d.ts.net/` failed with `Could not resolve host` because local host resolution had not picked up the new MagicDNS record. Direct verification with explicit resolution succeeded:
  - `curl -fsS --resolve looparr.tail0307d.ts.net:443:100.64.214.29 https://looparr.tail0307d.ts.net/`: HTML with `<title>looparr</title>`.
  - `curl -fsS --resolve ... /api/state`: expected JSON.
  - SSE through TLS proxy with explicit resolution: expected headers, `retry: 3000`, and initial `event: state`.

## Issues found and fixed

- `extra_hosts` with `network_mode: service:tailscale` produced daemon error `conflicting options: custom host-to-IP mapping and the network mode`. Removed `extra_hosts`.
- Moving `extra_hosts` to the Tailscale sidecar broke network namespace sharing and caused app/sidecar netns mismatch. Removed it entirely and used the Docker bridge gateway (`172.17.0.1`) for the host executor URL.
- Node 20 `fetch()` to the Docker gateway failed with `Error: bad port`. Rewrote bridge client using Node `http`/`https` request.
- Tailscale sidecar restarted repeatedly after a new auth key because `serve.json` used an array for `TCP`. Fixed to sibling shape: `"TCP": { "443": { "HTTPS": true } }`.
- A 30-second background shell timeout killed the first long-lived host executor with SIGTERM. Restarted it with a long timeout.

## Remaining

- Commit changes locally. No remote and no push.
- Keep the host executor running for hosted task execution.
- Funnel remains disabled; explicit approval required before enabling.
