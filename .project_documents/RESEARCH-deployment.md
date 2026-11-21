# Deployment research note

Goal: host looparr at `https://looparr.tail0307d.ts.net/` using the same Tailscale sidecar pattern as Curatarr and Splitarr.

## Sibling files read

- `/home/michaelpeele/ai-projects/Curatarr/docker-compose.yml`
- `/home/michaelpeele/ai-projects/Curatarr/curatarr-tailscale-data/serve.json`
- `/home/michaelpeele/ai-projects/Curatarr/README.md`
- `/home/michaelpeele/ai-projects/Curatarr/.project_documents/CHECKPOINT.md`
- `/home/michaelpeele/ai-projects/Curatarr/scripts/d4-cutover.sh`
- `/home/michaelpeele/ai-projects/splitarr/docker-compose.yml`
- `/home/michaelpeele/ai-projects/splitarr/.env.example`
- `/home/michaelpeele/ai-projects/splitarr/.project_documents/CHECKPOINT.md`
- `/home/michaelpeele/ai-projects/splitarr/.project_documents/PROGRESS.md`

## Pattern extracted

Both siblings use:

- Tailscale sidecar image `tailscale/tailscale:latest`.
- App container joined with `network_mode: "service:tailscale"`.
- `TS_AUTHKEY`, `TS_STATE_DIR=/var/lib/tailscale`, `TS_SERVE_CONFIG`, and `TS_CERT_DOMAIN`.
- Persisted Tailscale state directory.
- Sidecar hostname matching the app name.
- `/dev/net/tun` mount and caps `NET_ADMIN`, `NET_RAW`, `SYS_ADMIN`.
- Serve config with TCP `443`, `HTTPS: true`, and Web handler `"${TS_CERT_DOMAIN}:443"` proxying to plain local HTTP.
- Host debug port published on the sidecar because the app shares its network namespace.
- Verification with `tailscale serve status`, `tailscale funnel status`, and `curl` against the HTTPS URL.

Sibling proxy targets differ by app: Curatarr uses `http://172.22.0.1:5180`; Splitarr uses `http://127.0.0.1:8000`. Looparr uses `http://127.0.0.1:3000`.

## Domain verification

Live checks showed:

- `docker exec ts-curatarr tailscale serve status` and `tailscale funnel status`: `https://curatarr.tail0307d.ts.net`.
- `docker exec ts-splitarr tailscale serve status` and `tailscale funnel status`: `https://splitarr.tail0307d.ts.net`.
- Host statuses only showed `https://pi-docker.tail0307d.ts.net`.

Suffix is `tail0307d.ts.net`; digits are `0-3-0-7`, not letter O. No conflicting evidence was found. Looparr target is `looparr.tail0307d.ts.net`.

## Decisions copied from siblings

- Same sidecar image, state dir, serve config shape, caps, hostname pattern, and verification commands.
- Same tailnet Serve behavior and local port published on the sidecar.

## Deliberate differences

- Serve only, not Funnel. `serve.json` has no `AllowFunnel`, and no Funnel command runs. Funnel requires explicit approval because Looparr can run AI CLIs in mounted project dirs.
- No OpenCode binary in the image. Execution stays on the host through a bearer-authenticated HTTP bridge.
- `/home/michaelpeele/ai-projects` is mounted read-write at the same absolute path so paths stored in `config.json` remain valid.
- `CONFIG_PATH=/app/data/config.json` persists Looparr config in `./data`.
- Express binds `HOST=0.0.0.0` inside the container.
