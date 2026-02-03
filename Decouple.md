# Adjutant Decoupling Plan: System-Agnostic Architecture

## Problem Statement

Adjutant is currently tightly coupled to Gas Town's multi-agent orchestration system.
It assumes a `mayor/town.json` exists, a `gt` binary is available, agents follow the
mayor/deacon/witness/refinery/crew/polecat topology, and all communication flows through
`gt mail send`. This makes Adjutant unusable outside of a full Gas Town deployment.

**Goal**: Allow Adjutant to run with:
1. A single Claude Code instance (solo developer)
2. A small swarm of 5-10 agents (lightweight multi-agent)
3. A full Gas Town deployment (current behavior, unchanged)

**Bridge**: BEADS remains the universal interface. All three modes use `bd` for task
management, kanban boards, mail, and issue tracking. The `gt` binary and its concepts
(mayor, rigs, town root) become optional.

---

## Coupling Inventory

### Tier 1: Hard Coupling (Blocks Standalone Use)

These are the show-stoppers. Adjutant crashes or fails to start without Gas Town.

| File | Coupling | Impact |
|------|----------|--------|
| `backend/src/services/gastown-workspace.ts` | `resolveTownRoot()` throws if no `mayor/town.json` found | **Fatal on startup** |
| `backend/src/services/gt-executor.ts` | `resolveGtBinary()` + all `execGt()` calls require `gt` in PATH | **Fatal for mail, agents, power** |
| `backend/src/services/power-service.ts` | `gt up` / `gt down` - entire concept is GT-specific | **Fatal for power routes** |
| `scripts/dev.sh` | Validates `$GT_DIR/mayor/town.json` on startup | **Blocks dev server start** |

### Tier 2: Semantic Coupling (Wrong Behavior Without GT)

These won't crash, but produce wrong/confusing results in standalone mode.

| File | Coupling | Impact |
|------|----------|--------|
| `backend/src/services/agents-service.ts` | `resolveTownRoot()` + agent topology assumes GT roles | Shows wrong agent list |
| `backend/src/services/mail-service.ts` | Primary path uses `gt mail send`, fallback uses `bd create` | Mail may fail (but fallback exists) |
| `backend/src/services/agent-data.ts` | Hardcoded role normalization: `coordinator → mayor`, `health-check → deacon` | Wrong role mapping |
| `backend/src/services/gastown-utils.ts` | `sessionNameForAgent()` hardcodes `hq-mayor`, `gt-{rig}-witness`, etc. | Wrong tmux session names |
| `backend/src/types/index.ts` | `AgentType = "mayor" \| "deacon" \| "witness" \| "refinery" \| "crew" \| "polecat"` | No room for non-GT agent types |
| `backend/src/types/index.ts` | `GastownStatus` interface assumes mayor/deacon/daemon infrastructure | Status API returns GT-shaped data |

### Tier 3: Cosmetic Coupling (Naming/Branding Only)

These don't affect functionality but leak Gas Town terminology into a general-purpose tool.

| File | Coupling |
|------|----------|
| `package.json` | Description: "Retro terminal UI for Gastown multi-agent orchestration" |
| `frontend/index.html` | `<title>Adjutant - Gastown Dashboard</title>` |
| `README.md` | References to Gas Town throughout |
| `frontend/src/components/chat/MayorChat.tsx` | Component name assumes mayor exists |
| `frontend/src/components/mail/RecipientSelector.tsx` | Mayor as default/special recipient |
| `ios/AdjutantWidgets/GastownWidget.swift` | Widget named after Gas Town |
| `backend/src/config/voice-config.ts` | Voice config for `"mayor/"` |
| Various iOS views | Mayor as default chat recipient, crown emoji |

### Environment Variable Coupling

| Variable | Used By | GT-Specific? |
|----------|---------|-------------|
| `GT_TOWN_ROOT` | `gastown-workspace.ts`, `dev.sh` | Yes |
| `GT_BIN` / `GT_PATH` | `gastown-workspace.ts` | Yes |
| `GT_RIG_PATHS` / `GT_EXTRA_RIGS` | `gastown-workspace.ts` | Yes |
| `GT_MAIL_IDENTITY` | `mail-service.ts` | Partially (identity concept is universal) |
| `BD_ACTOR` | `gt-executor.ts`, `mail-service.ts` | No (beads concept, keep as-is) |
| `BEADS_DIR` | `bd-client.ts` | No (beads concept, keep as-is) |

---

## Existing Seams (Things Working In Our Favor)

1. **`bd-client.ts` already talks to beads directly.** The `execBd()` function is
   independent of Gas Town. It just needs a beads directory.

2. **Mail service has a `bd create` fallback.** When `gt mail send` fails, it falls
   back to creating beads directly. This fallback path IS standalone mode.

3. **Beads directories are self-contained.** A `.beads/` directory works anywhere.
   No town root needed. The `bd` CLI is independent of `gt`.

4. **The frontend is API-driven.** It consumes REST endpoints. The backend can
   return different shapes without frontend code changes (if we version carefully).

5. **RigContext already handles "no rigs" gracefully.** When `availableRigs` is empty,
   all items pass the filter.

---

## Decoupling Strategy: Five Phases

Each phase is a discrete, shippable change. Existing Gas Town functionality never breaks.

### Phase 1: Workspace Provider Abstraction

**Goal**: Replace hardcoded `resolveTownRoot()` calls with a pluggable workspace
provider. Gas Town becomes the default provider. A standalone provider becomes possible.

**Changes**:

1. Create `backend/src/services/workspace/workspace-provider.ts`:
   ```typescript
   export interface WorkspaceProvider {
     /** Name of this provider (e.g., "gastown", "standalone") */
     readonly name: string;

     /** Root directory for this workspace */
     resolveRoot(): string;

     /** List all beads directories to scan */
     listBeadsDirs(): Promise<BeadsDirInfo[]>;

     /** Resolve beads dir for a specific bead ID */
     resolveBeadsDirFromId(beadId: string): { workDir: string; beadsDir: string } | null;

     /** Whether this workspace has centralized power control */
     hasPowerControl(): boolean;

     /** Whether the gt binary is available */
     hasGtBinary(): boolean;
   }
   ```

2. Create `backend/src/services/workspace/gastown-provider.ts`:
   - Moves current `gastown-workspace.ts` logic here
   - Implements `WorkspaceProvider`
   - Behavior identical to today

3. Create `backend/src/services/workspace/standalone-provider.ts`:
   - `resolveRoot()` returns `cwd` or a configured project directory
   - `listBeadsDirs()` returns just the local `.beads/` directory
   - `hasPowerControl()` returns false
   - `hasGtBinary()` returns false

4. Create `backend/src/services/workspace/index.ts`:
   - Auto-detects provider: if `mayor/town.json` exists → GasTown, else → Standalone
   - Exports `getWorkspace(): WorkspaceProvider` singleton
   - Configurable via `ADJUTANT_MODE=standalone|gastown` env var

5. Update all callers of `resolveTownRoot()` to use `getWorkspace().resolveRoot()`.

**Non-breaking**: Gas Town detection is the default. Existing setups work unchanged.

---

### Phase 2: Agent Topology Abstraction

**Goal**: Make agent types extensible. Gas Town roles become one topology. Standalone
mode has simpler roles.

**Changes**:

1. Broaden `AgentType` in `backend/src/types/index.ts`:
   ```typescript
   /** Well-known agent types. Extensible via string union. */
   export type AgentType =
     | "mayor" | "deacon" | "witness" | "refinery"  // Gas Town infrastructure
     | "crew" | "polecat"                            // Gas Town workers
     | "user" | "agent"                              // Standalone mode
     | string;                                       // Future extensibility
   ```

2. Create `backend/src/services/topology/topology-provider.ts`:
   ```typescript
   export interface TopologyProvider {
     /** List known agent types for this deployment */
     agentTypes(): AgentType[];

     /** Get the "coordinator" agent type (mayor in GT, user in standalone) */
     coordinatorType(): AgentType;

     /** Map a raw role string to an AgentType */
     normalizeRole(role: string): AgentType;

     /** Build agent address from role/rig/name */
     buildAddress(role: string, rig: string | null, name: string | null): string | null;

     /** Map agent to tmux session name (if applicable) */
     sessionName(role: string, rig: string | null, name: string | null): string | null;
   }
   ```

3. Create `gastown-topology.ts` (current logic from `gastown-utils.ts`) and
   `standalone-topology.ts` (simpler agent model).

4. Update `agents-service.ts` and `agent-data.ts` to use topology provider.

**Non-breaking**: Gas Town topology is auto-detected when `mayor/town.json` exists.

---

### Phase 3: Communication Abstraction

**Goal**: Abstract how messages are sent and notifications delivered. The mail service
currently tries `gt mail send` first, then falls back to `bd create`. Make this a
first-class strategy pattern.

**Changes**:

1. Create `backend/src/services/mail/mail-transport.ts`:
   ```typescript
   export interface MailTransport {
     /** Send a mail message */
     send(params: MailSendParams): Promise<MailSendResult>;

     /** Notify an agent they have new mail */
     notify(session: string, message: string): Promise<void>;
   }
   ```

2. Create `gastown-transport.ts`:
   - Uses `gt mail send` with `--notify`
   - Falls back to `bd create` + tmux nudge (current behavior)

3. Create `beads-transport.ts`:
   - Uses `bd create` directly (no `gt` dependency)
   - Notification is optional (could use filesystem watches, webhooks, etc.)

4. Update `mail-service.ts` to use transport interface instead of inline gt/bd logic.

5. Generalize `sendTmuxNotification()` and `nudgeSession()` into a
   notification provider (tmux is one strategy, could add others later).

**Non-breaking**: `GasTownTransport` is the default when `gt` is available.

---

### Phase 4: Status & Power Generalization

**Goal**: Make the status API work without Gas Town infrastructure. Power controls
become optional.

**Changes**:

1. Create `backend/src/services/status/status-provider.ts`:
   ```typescript
   export interface StatusProvider {
     /** Get system status */
     getStatus(): Promise<SystemStatus>;

     /** Whether power controls are available */
     hasPowerControl(): boolean;

     /** Start the system (if power control available) */
     powerUp?(): Promise<PowerTransitionResult>;

     /** Stop the system (if power control available) */
     powerDown?(): Promise<PowerTransitionResult>;
   }
   ```

2. Generalize `GastownStatus` → `SystemStatus`:
   ```typescript
   export interface SystemStatus {
     mode: "gastown" | "standalone" | "swarm";
     powerState: PowerState;  // "running" in standalone (always on)
     workspace: { name: string; root: string; };
     operator: { name: string; email: string; unreadMail: number; };
     infrastructure?: { ... };  // Optional, only present in GT mode
     rigs?: RigStatus[];        // Optional, only present in GT mode
     agents: AgentInfo[];       // Universal: list of all known agents
     fetchedAt: string;
   }
   ```

3. Update `power.ts` route to return 404/501 when power control is unavailable.

4. Update frontend to conditionally render power controls and infrastructure
   sections based on `status.mode`.

**Non-breaking**: The existing `GastownStatus` shape is a superset of `SystemStatus`.
Frontend gets new fields but can still read all old fields.

---

### Phase 5: Frontend & UI Generalization

**Goal**: Make the UI adapt to the deployment mode. Mayor Chat becomes Command Chat.
Rig filtering is hidden when there are no rigs. GT-specific components become
conditional.

**Changes**:

1. Rename/generalize key components:
   - `MayorChat.tsx` → `CommandChat.tsx` (recipient configurable)
   - Default recipient comes from topology provider's `coordinatorType()`
   - "Mayor" label becomes the coordinator's display name

2. `RecipientSelector.tsx`: Remove hardcoded mayor special-casing.
   Instead, mark the coordinator as the "pinned" recipient dynamically.

3. `CrewStats.tsx`: Show agent topology based on what's available.
   In standalone mode, just show the user and their agents.

4. Conditionally hide GT-specific UI elements:
   - Power controls (when `hasPowerControl() === false`)
   - Rig filter (when no rigs exist)
   - Infrastructure section (when no GT infrastructure agents)

5. Update iOS app similarly:
   - `GastownWidget.swift` → `AdjutantWidget.swift`
   - Default chat recipient comes from config, not hardcoded mayor

**Non-breaking**: All changes are additive. GT mode renders exactly as before.

---

## Deployment Modes

### Standalone Mode (`ADJUTANT_MODE=standalone`)

```
project/
  .beads/          ← Single beads database for everything
  src/             ← Your code
```

- No `gt` binary required
- No mayor, deacon, witness, refinery
- Agent types: `user` (you) and `agent` (your Claude Code instances)
- Mail goes directly via `bd create`
- No power controls (always "running")
- No rig filtering (single project)

### Swarm Mode (`ADJUTANT_MODE=swarm`)

```
workspace/
  .beads/          ← Shared beads database
  project-a/       ← Agent 1's workspace
  project-b/       ← Agent 2's workspace
```

- No `gt` binary required
- Agent types: `user` and `agent` (or custom roles)
- Multiple agents tracked via beads agent records
- Optional tmux-based notification
- No formal infrastructure roles

### Gas Town Mode (`ADJUTANT_MODE=gastown` or auto-detected)

```
~/gt/
  mayor/town.json  ← Gas Town marker
  adjutant/        ← Rig with .beads/
  ...
```

- Full Gas Town integration (current behavior, unchanged)
- All GT roles, rig topology, power controls
- `gt` binary used for mail, agents, power

---

## Implementation Order & Dependencies

```
Phase 1 ─────► Phase 2 ─────► Phase 3
(workspace)    (topology)     (comms)
                    │              │
                    └──────► Phase 4
                            (status)
                                │
                                └──► Phase 5
                                     (frontend)
```

Phase 1 is the foundation. Phases 2-3 can proceed in parallel after Phase 1.
Phase 4 depends on 2. Phase 5 depends on 4.

---

## Migration Checklist Per Phase

Each phase follows this pattern:

1. **Create interface** - Define the abstraction
2. **Implement GT provider** - Wrap existing code (behavior identical)
3. **Wire up with auto-detection** - GT detected? Use GT provider. Otherwise? Standalone.
4. **Update callers** - Replace direct imports with provider calls
5. **Create standalone provider** - Implement the alternative
6. **Test both paths** - Ensure GT mode unchanged, standalone mode works
7. **Ship it** - Each phase is independently deployable

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking GT mode during refactoring | GT provider wraps existing code verbatim. Tests run in GT mode first. |
| Interface too abstract, hard to use | Keep interfaces minimal. Only abstract what varies between modes. |
| Performance regression from indirection | Providers are resolved once at startup and cached. No per-request overhead. |
| Frontend breaks on new status shape | Status API returns a superset. New fields are additive. |
| `bd` CLI not available in standalone | `bd` is a standalone Go binary. It's the bridge that works everywhere. |

---

## What Stays Coupled (By Design)

These things intentionally remain:

- **BEADS (`bd` CLI)**: This IS the universal interface. All modes require it.
- **Tmux detection**: Agent running/stopped detection uses tmux session checks.
  This is reasonable even in standalone mode (Claude Code runs in tmux).
- **The Adjutant backend/frontend architecture**: The web dashboard concept is universal.
- **Push notifications (APNS)**: iOS notifications work regardless of deployment mode.

---

## Open Questions

1. **Swarm mode agent discovery**: Without `gt agents list`, how does Adjutant discover
   agents in swarm mode? Options: beads agent records, tmux session scanning, config file.

2. **Standalone mail identity**: In GT mode, identity is `overseer`. In standalone mode,
   what should the user's identity be? Probably configurable via `ADJUTANT_IDENTITY`.

3. **Config file vs env vars**: Should we introduce an `adjutant.config.json` for
   deployment configuration, or continue using environment variables?

4. **Backward compatibility window**: How long do we maintain the old direct-import
   patterns alongside the provider patterns? Suggestion: remove old patterns in the
   same phase they're replaced (since GT provider preserves behavior).
