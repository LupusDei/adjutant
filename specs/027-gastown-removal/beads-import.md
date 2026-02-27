# Beads Import: adj-027 — Remove Gas Town from Adjutant

## adj-027 [epic] [P1]
Remove Gas Town from Adjutant

Epic: Remove ALL Gas Town-specific code, types, UI, config, and references from the working system. Adjutant becomes a standalone multi-agent dashboard using beads + MCP only. Swarm mode becomes the sole operating mode. See specs/027-gastown-removal/spec.md for full details.

---

## adj-027.1 [epic] [P1]
Backend: Remove Gastown providers & collapse to single mode

Delete all Gastown provider implementations and collapse the dual-mode architecture. Swarm mode becomes the only mode. Remove gt CLI dependency entirely. Remove all mail transport (gt-backed mail removed per user decision). Remove power control. Remove polecats.

---

## adj-027.1.1 [task] [P1]
Delete Gastown provider files and gt CLI wrappers

Delete: workspace/gastown-provider.ts, topology/gastown-topology.ts, status/gastown-status-provider.ts, transport/gastown-transport.ts, gt-executor.ts, gt-control.ts, gastown-workspace.ts, gastown-utils.ts, power-service.ts. Remove all imports of these files from other modules.

---

## adj-027.1.2 [task] [P1]
Simplify provider index files — remove mode detection

Update workspace/index.ts, topology/index.ts, status/index.ts, transport/index.ts to remove all Gastown imports and mode detection. Always return swarm/beads providers directly. Remove getDeploymentMode(), resolveTownRoot() compat. Remove reset functions (no mode switching). Remove isGasTownEnvironment checks.

---

## adj-027.1.3 [task] [P1]
Remove mode-service, mode route, and ADJUTANT_MODE

Delete mode-service.ts. Delete routes/mode.ts. Remove ADJUTANT_MODE env var handling everywhere. Remove mode:changed events from event-bus. Remove all getModeInfo()/switchMode() callers.

---

## adj-027.1.4 [task] [P1]
Remove power routes, power service, and all mail routes

Delete routes/power.ts, routes/mail.ts, power-service.ts. Remove endpoint registrations. Remove all gt-backed mail transport. The MCP SQLite message store is the only messaging system.

---

## adj-027.1.5 [task] [P1]
Clean up backend types — remove Gastown types

Update types/index.ts: Remove GastownStatus, RigStatus, PowerState, Gas Town AgentType values (mayor, deacon, witness, refinery, crew, polecat). Keep only user and agent types. Remove mail-related types (Message, thread types). Keep SystemStatus from status-provider as canonical.

---

## adj-027.1.6 [task] [P1]
Simplify agent-data and agents-service

Remove rig scanning, Gastown role parsing, town-level agent detection from agent-data.ts. Simplify agents-service.ts to flat agent list. Remove polecat spawn from agents route. Remove all polecat references. Preserve swarm agent spawn functionality.

---

## adj-027.1.7 [task] [P2]
Update config paths from ~/.gastown to ~/adjutant

Update voice-config-service.ts and api-key-service.ts to use ~/adjutant/ instead of ~/.gastown/. Support both paths temporarily with deprecation warning for old path. Update cli/lib/checks.ts.

---

## adj-027.1.8 [task] [P1]
Update backend tests for Gastown removal

Update all backend/tests/ files referencing Gastown types, modes, providers, gt-executor, mail, power. Remove tests for deleted files. Update remaining tests for single-mode architecture.

---

## adj-027.2 [epic] [P1]
Frontend: Remove Gastown UI & collapse to single mode

Delete all Gastown-specific components, hooks, contexts. Remove mode detection and conditional rendering. Remove mail tab entirely. Remove power controls. Remove rig filtering. Remove polecats UI.

---

## adj-027.2.1 [task] [P1]
Delete Gastown-only frontend components and hooks

Delete: power/PowerButton.tsx, power/NuclearPowerButton.tsx, power/ directory. Delete mail/ directory entirely. Delete shared/RigFilter.tsx, shared/RigBadge.tsx. Delete hooks/useGastownStatus.ts, hooks/useDeploymentMode.ts, hooks/useMail.ts.

---

## adj-027.2.2 [task] [P1]
Remove ModeContext and all mode detection

Remove or replace contexts/ModeContext.tsx. Remove DeploymentMode type, isGasTown/isSwarm flags, useMode() hook, useVisibleTabs(). Make tabs statically defined. Remove mode switching from settings.

---

## adj-027.2.3 [task] [P1]
Clean up frontend types

Update types/index.ts: Remove GastownStatus, RigStatus, PowerState, DeploymentMode, Gas Town AgentType values. Remove rig from CrewMember. Remove mail-related Message types. Keep only user and agent for AgentType.

---

## adj-027.2.4 [task] [P1]
Clean up frontend API service

Update services/api.ts: Remove power.up/down, getStatus() GastownStatus, all mail endpoints. Remove rig param from beads.list/epics.list. Remove agents.spawnPolecat. Remove mode API calls. Preserve swarm agent spawn.

---

## adj-027.2.5 [task] [P1]
Simplify CrewStats component

Remove rig grouping (TownSection, RigSection). Remove polecat references. Remove SHOW ALL POLECATS. Remove mayor/deacon/witness/refinery rendering. Simplify to flat agent list. Remove all isGasTown/isSwarm branches. Preserve swarm spawn agent functionality.

---

## adj-027.2.6 [task] [P1]
Clean up dashboard, navigation, and remaining components

Remove power widget from dashboard. Remove rig status sections. Remove mail tab from navigation. Remove mode-conditional tab rendering. Clean up DashboardView.css. Remove all remaining useMode()/isGasTown refs.

---

## adj-027.2.7 [task] [P1]
Update frontend tests for Gastown removal

Update all frontend/tests/ referencing Gastown types, modes, power, rigs, mail, polecats. Remove tests for deleted components/hooks. Update remaining tests.

---

## adj-027.3 [epic] [P1]
iOS: Remove Gastown models & views

Remove Gas Town models, views, and API integrations from iOS app. Remove power control, rig filtering, mail, convoys, polecats, mode switching.

---

## adj-027.3.1 [task] [P1]
Simplify iOS data models

Replace GastownStatus.swift with simplified SystemStatus (no rigs, no infrastructure hierarchy). Delete Convoy.swift. Update Enums.swift: remove PowerState, remove DeploymentMode, remove Gas Town AgentType values. Update Agent.swift: remove rig from CrewMember, remove SpawnPolecatRequest, remove TerminalCapture.

---

## adj-027.3.2 [task] [P1]
Remove iOS Gastown UI components

Delete PowerButton.swift. Delete RigFilterDropdown.swift. Remove power control views and rig filter views from navigation. Update all views referencing deleted components.

---

## adj-027.3.3 [task] [P1]
Update iOS API endpoints

Remove getStatus() GastownStatus, getPowerStatus(), powerUp(), powerDown(). Remove polecat endpoints. Remove gt-backed mail endpoints. Keep MCP-backed persistent messaging endpoints.

---

## adj-027.3.4 [task] [P1]
Update iOS AppState and ViewModels

Remove isPowerOn, powerState, availableRigs, deploymentMode, availableModes from AppState. Remove mode switching methods, rig fetching. Simplify tab visibility (static). Update DashboardViewModel (remove rigStatuses). Update ChatViewModel (remove mayor/ default). Update SettingsViewModel (remove mode switching, rigs, power). Remove Mail feature views entirely.

---

## adj-027.3.5 [task] [P1]
Update iOS tests for Gastown removal

Update all iOS tests referencing GastownStatus, PowerState, DeploymentMode, mode transitions, power control, rigs, convoys, polecats, mail. Remove tests for deleted models/views. Update remaining tests.

---

## adj-027.4 [epic] [P2]
Config & Docs: Remove Gastown references

Update all configuration, rules, and documentation. Preserve historical specs and archived docs.

---

## adj-027.4.1 [task] [P2]
Rewrite CLAUDE.md for standalone Adjutant

Remove Mayor Context heading. Remove ~/gt references. Remove gt prime command. Describe Adjutant as standalone multi-agent dashboard using beads + MCP. Update Active Technologies. Remove Gas Town scope section.

---

## adj-027.4.2 [task] [P2]
Update .claude/rules/ for Gastown removal

Rewrite 01-project-context.md (remove Gastown/gt/rigs/mayor). Update 02-code-style.md (replace naming examples). Update 03-testing.md (remove gt-executor refs). Rewrite 04-architecture.md (remove GT Executor layer). Update 06-speckit-workflow.md (remove Gastown beads refs).

---

## adj-027.4.3 [task] [P2]
Update README and package.json

Rewrite README.md: Remove Gastown prerequisites, gt CLI dependency, Gastown troubleshooting. Describe standalone setup. Update root/backend/frontend package.json: descriptions and keywords.

---

## adj-027.4.4 [task] [P2]
Update CLI, skills, and agent setup docs

Update cli/lib/checks.ts: ~/.gastown → ~/adjutant. Update docs/adjutant-agent-setup.md. Update skills/ templates: remove gt- prefix examples, generalize bead prefix references.

---

## adj-027.5 [epic] [P2]
Cleanup & Verification

Final sweep to confirm zero Gastown references in working code. Full build/test verification.

---

## adj-027.5.1 [task] [P2]
Final Gastown reference sweep and verification

Grep all .ts/.tsx/.swift for gastown, gas town, gt-executor, mayor, deacon, witness, refinery, polecat, rig, mail route references. Verify npm build, npm test, iOS build. Verify MCP, WebSocket, beads work end-to-end. Remove unused dependencies. Final sign-off.
