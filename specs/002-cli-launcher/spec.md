# Feature Specification: CLI Launcher

**Feature Branch**: `002-cli-launcher`
**Created**: 2026-01-11
**Status**: Ready
**Input**: User description: "Running gt-boy from a gastown directory should start the gastown-boy system and localhost UI"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start Gastown-Boy (Priority: P1)

As a gastown operator, I want to run a single command from my gastown directory to start the gastown-boy UI so I can quickly access the Pip-Boy interface without manually starting multiple services.

**Why this priority**: This is the core functionality - without it, users cannot launch gastown-boy conveniently. Everything else depends on this working.

**Independent Test**: Can be tested by running `gt-boy` from a gastown directory and verifying the UI opens in the browser.

**Acceptance Scenarios**:

1. **Given** the user is in a gastown directory (contains `.gastown` or is a valid town), **When** they run `gt-boy`, **Then** the backend server starts, the frontend server starts, and the browser opens to the UI
2. **Given** the user runs `gt-boy` from a non-gastown directory, **When** the command executes, **Then** a clear error message explains that they must run from a gastown directory
3. **Given** the backend and frontend are starting, **When** the user views the terminal, **Then** they see startup progress messages indicating what is happening
4. **Given** gastown-boy is already running, **When** the user runs `gt-boy` again, **Then** the browser opens to the existing instance (no duplicate servers started)

---

### User Story 2 - Graceful Shutdown (Priority: P2)

As a gastown operator, I want to cleanly stop gastown-boy with Ctrl+C so that all services shut down properly without leaving orphaned processes.

**Why this priority**: Essential for a good developer experience, but the system could technically work without graceful shutdown (just kill processes manually).

**Independent Test**: Can be tested by running `gt-boy`, pressing Ctrl+C, and verifying both servers stop and the terminal returns to the prompt.

**Acceptance Scenarios**:

1. **Given** gastown-boy is running, **When** the user presses Ctrl+C, **Then** both backend and frontend servers stop gracefully within 5 seconds
2. **Given** gastown-boy is running, **When** the user presses Ctrl+C, **Then** a shutdown message confirms services are stopping
3. **Given** a server fails to stop within the timeout, **When** the timeout expires, **Then** the process is forcefully terminated and the user is notified

---

### User Story 3 - Custom Port Configuration (Priority: P3)

As a gastown operator, I want to specify custom ports when starting gastown-boy so I can avoid conflicts with other services on my machine.

**Why this priority**: Nice to have for advanced users, but defaults work for most cases.

**Independent Test**: Can be tested by running `gt-boy --port 4000` and verifying the UI is accessible on the custom port.

**Acceptance Scenarios**:

1. **Given** the user runs `gt-boy --port 4000`, **When** the servers start, **Then** the frontend is accessible at `http://localhost:4000`
2. **Given** the user runs `gt-boy --backend-port 4001`, **When** the servers start, **Then** the backend API is accessible at `http://localhost:4001`
3. **Given** the specified port is already in use, **When** `gt-boy` tries to start, **Then** a clear error message indicates the port conflict

---

### Edge Cases

- What happens when gastown is not installed or `gt` is not in PATH?
  - Display error: "Gastown not found. Please install gastown and ensure 'gt' is in your PATH."
- What happens when the backend fails to start?
  - Display the backend error output and exit with non-zero status
- What happens when the frontend fails to start?
  - Stop the backend, display the frontend error, and exit with non-zero status
- What happens when the browser fails to open?
  - Continue running and display the URL for manual access
- What happens when running on a headless server?
  - Skip browser open, just display the URL

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `gt-boy` command that can be run from any gastown directory
- **FR-002**: System MUST detect whether the current directory is a valid gastown town
- **FR-003**: System MUST start the backend server on a configurable port (default: 3001)
- **FR-004**: System MUST start the frontend server on a configurable port (default: 5173)
- **FR-005**: System MUST open the default browser to the frontend URL after servers are ready
- **FR-006**: System MUST display startup progress in the terminal
- **FR-007**: System MUST handle Ctrl+C to gracefully shutdown both servers
- **FR-008**: System MUST prevent duplicate instances (detect if already running)
- **FR-009**: System MUST provide clear error messages for common failure scenarios
- **FR-010**: System MUST pass the gastown directory path to the backend for `gt` command execution

### Key Entities

- **GastownDirectory**: A directory containing a valid gastown town (has `.gastown` marker or passes `gt status` check). The `gt-boy` command operates relative to this directory.
- **ServerProcess**: A running instance of either the backend or frontend server. Tracked for lifecycle management (start, health check, shutdown).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can start gastown-boy with a single command in under 10 seconds
- **SC-002**: The browser opens to the UI automatically in 95% of cases (excluding headless environments)
- **SC-003**: Ctrl+C shuts down all services within 5 seconds
- **SC-004**: Error messages clearly indicate the problem and suggest a fix in 100% of failure cases
- **SC-005**: Zero orphaned processes remain after shutdown

## Assumptions

- The `gt-boy` command will be installed globally or added to PATH
- Users have Node.js installed (required for running the servers)
- The gastown-boy backend/frontend code is bundled with or accessible to the CLI
- Default ports (3001, 5173) are typically available on developer machines
- The `open` command (macOS) or equivalent is available for opening browsers
