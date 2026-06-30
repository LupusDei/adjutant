# Adjutant dev-server supervisors (launchd)

Self-healing supervision for the local Adjutant stack, mirroring the existing Dolt
supervisors. Before this, **only Dolt was launchd-supervised** — the backend
(`tsx watch`) and frontend (`vite`) ran under a `concurrently` dev stack with no
crash or session recovery. When Vite died (often: a node-ABI mismatch after
`node_modules` was reinstalled under a different nvm node), the dashboard and the
`cc.jmm.ngrok.io` tunnel went 502 until someone manually restarted it. (adj-yi6do)

## Runner model — launchd is canonical

On this host, **launchd owns the backend, frontend, and ngrok tunnel.** The
`concurrently` dev stack (`scripts/dev.sh` / `npm run dev`) is **retired for these
services here.**

> Do **not** run `npm run dev` while the supervisors are loaded — both would bind
> `:4200`/`:4201`. Vite runs with `--strictPort`, so the loser crash-loops.

For a one-off local hack on a *different* machine (no supervisors), `npm run dev`
still works as before — this model is the deployment posture for the fleet host.

## Components

| LaunchAgent label          | Wrapper (`~/.adjutant/`)      | Purpose                                   | Restart |
|----------------------------|------------------------------|-------------------------------------------|---------|
| `com.adjutant.backend`     | `adjutant-backend.sh`        | Backend API `:4201` (`tsx watch`)         | KeepAlive |
| `com.adjutant.frontend`    | `adjutant-frontend.sh`       | Vite `:4200` (`--strictPort --host`)      | KeepAlive |
| `com.adjutant.ngrok`       | `adjutant-ngrok.sh`          | ngrok tunnel `cc.jmm.ngrok.io -> :4200`   | KeepAlive |
| `com.adjutant.server-heal` | `adjutant-server-heal.sh`    | 120s health watchdog (kickstart on drift) | StartInterval 120 |

- **Pinned node:** every wrapper sources nvm and `nvm use` (`.nvmrc` => `v20.19.6`)
  before exec'ing, so the running node always matches the installed native bins
  (esbuild / `@rollup/rollup-darwin-x64`). This is the root-cause fix for the Vite
  ABI-mismatch crashes.
- **Backend watch mode:** kept (`tsx watch`) so a merge to `main` live-reloads. Set
  `ADJUTANT_NO_WATCH=1` in the plist env for a stable, no-reload backend during
  heavy multi-agent sessions (adj-8mmyd). KeepAlive restarts on crash either way.
- **Heal watchdog:** KeepAlive only restarts on process *death*. The watchdog
  catches *hung-but-listening* / wedged-port / crash-loop-faster-than-health cases
  by curling each endpoint and `launchctl kickstart -k`ing the drifted job — the
  same rationale as `~/.adjutant/dolt-heal.sh`.
- **Logs:** `/tmp/com.adjutant.{backend,frontend,ngrok,server-heal}.log` (survive a
  closed terminal).

## Install / cutover

```bash
# Full install + cutover (frees :4200/:4201 listeners, then loads the jobs):
./scripts/install-server-supervisors.sh

# Write wrappers + plists only, do NOT load (stage for a coordinated cutover):
./scripts/install-server-supervisors.sh --files-only

# Remove all four jobs (wrappers in ~/.adjutant are left in place):
./scripts/install-server-supervisors.sh --uninstall
```

The installer frees the ports using **listener-only** kills (adj-102 safe-kill
semantics) so connected MCP agents are never collaterally killed.

### Cutover note (live host)

The backend `:4201` serves the whole fleet. Loading `com.adjutant.backend` triggers
a normal backend restart (a few-second blip — the same blip a merge-to-`main`
reload causes). Do the cutover at a quiet moment and verify health immediately:

```bash
launchctl list | grep com.adjutant
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4201/health   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4200          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://cc.jmm.ngrok.io        # 200
```

## Acceptance (verified)

```bash
# Backend auto-restart:
kill "$(lsof -ti:4201 -sTCP:LISTEN)"; sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4201/health   # -> 200

# Frontend auto-restart (ngrok stays green):
kill "$(lsof -ti:4200 -sTCP:LISTEN)"; sleep 6
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4200          # -> 200
curl -s -o /dev/null -w '%{http_code}\n' https://cc.jmm.ngrok.io        # -> 200

# Pinned node:
ps -o command= -p "$(lsof -ti:4200 -sTCP:LISTEN)" | grep -q v20.19.6    # node v20.19.6
```

## Files live OUTSIDE the repo

The wrappers (`~/.adjutant/*.sh`) and plists (`~/Library/LaunchAgents/com.adjutant.*.plist`)
are **not** tracked by git. The repo holds the source of truth in
`scripts/supervisor/` + `scripts/install-server-supervisors.sh`; re-run the
installer to (re)materialize them. Edit the repo copies, never the `~/.adjutant`
copies.
