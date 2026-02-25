import Foundation

// MARK: - Status Endpoints

extension APIClient {
    /// Retrieves the current status of the Gas Town system.
    ///
    /// Returns comprehensive information about the system including:
    /// - Power state (running, stopped, starting, stopping)
    /// - System uptime
    /// - List of active rigs
    /// - Agent counts and status summary
    ///
    /// ## Example
    /// ```swift
    /// let status = try await client.getStatus()
    /// print("Power: \(status.power)")
    /// print("Uptime: \(status.uptime ?? "unknown")")
    /// print("Active rigs: \(status.rigs.count)")
    /// ```
    ///
    /// - Returns: A ``GastownStatus`` containing complete system information.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getStatus() async throws -> GastownStatus {
        try await requestWithEnvelope(.get, path: "/status")
    }
}

// MARK: - Power Endpoints

extension APIClient {
    /// Get current power state (alias for status endpoint)
    public func getPowerStatus() async throws -> GastownStatus {
        try await requestWithEnvelope(.get, path: "/power/status")
    }

    /// Start Gastown
    public func powerUp() async throws -> PowerStateChange {
        try await requestWithEnvelope(.post, path: "/power/up")
    }

    /// Stop Gastown
    public func powerDown() async throws -> PowerStateChange {
        try await requestWithEnvelope(.post, path: "/power/down")
    }
}

// MARK: - Mail Endpoints

extension APIClient {
    /// Filter options for mail queries.
    ///
    /// Use these to filter messages by category:
    /// - `.user`: Regular user messages
    /// - `.infrastructure`: System and coordination messages
    public enum MailFilter: String {
        case user
        case infrastructure
    }

    /// Retrieves mail messages from the inbox.
    ///
    /// By default, returns only the current identity's unread and recent messages.
    /// Use the `all` parameter to retrieve the complete message history.
    ///
    /// ## Example
    /// ```swift
    /// // Get default inbox view
    /// let inbox = try await client.getMail()
    /// print("Messages: \(inbox.items.count)")
    ///
    /// // Get all user messages
    /// let allMail = try await client.getMail(filter: .user, all: true)
    ///
    /// // Get infrastructure messages only
    /// let sysMail = try await client.getMail(filter: .infrastructure)
    /// ```
    ///
    /// - Parameters:
    ///   - filter: Optional filter to show only user or infrastructure messages.
    ///   - all: If true, retrieves all messages instead of recent only.
    /// - Returns: A paginated response containing ``Message`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getMail(filter: MailFilter? = nil, all: Bool = false) async throws -> PaginatedResponse<Message> {
        var queryItems: [URLQueryItem] = []
        if let filter {
            queryItems.append(URLQueryItem(name: "filter", value: filter.rawValue))
        }
        if all {
            queryItems.append(URLQueryItem(name: "all", value: "true"))
        }

        return try await requestWithEnvelope(
            .get,
            path: "/mail",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Sends a new message to the specified recipient.
    ///
    /// Messages are the primary communication mechanism in Gas Town.
    /// All agents and the Mayor can receive messages through their mailboxes.
    ///
    /// ## Example
    /// ```swift
    /// // Simple message
    /// let request = SendMessageRequest(
    ///     to: "greenplace/witness",
    ///     subject: "Status Update",
    ///     body: "All systems operational."
    /// )
    /// try await client.sendMail(request)
    ///
    /// // High priority message
    /// let urgent = SendMessageRequest(
    ///     to: "mayor/",
    ///     subject: "CRITICAL: System failure",
    ///     body: "Immediate attention required.",
    ///     priority: .urgent
    /// )
    /// try await client.sendMail(urgent)
    /// ```
    ///
    /// - Parameter request: A ``SendMessageRequest`` with message details.
    /// - Returns: A ``SuccessResponse`` indicating the message was sent.
    /// - Throws: ``APIClientError`` if the request fails.
    public func sendMail(_ request: SendMessageRequest) async throws -> SuccessResponse {
        try await requestWithEnvelope(.post, path: "/mail", body: request)
    }

    /// Get the current mail sender identity
    public func getMailIdentity() async throws -> IdentityResponse {
        try await requestWithEnvelope(.get, path: "/mail/identity")
    }

    /// Get a single message by ID
    public func getMessage(id: String) async throws -> Message {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/mail/\(encodedId)")
    }

    /// Mark a message as read
    public func markMessageAsRead(id: String) async throws -> SuccessResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.post, path: "/mail/\(encodedId)/read")
    }

    /// Mark a message as unread
    public func markMessageAsUnread(id: String) async throws -> SuccessResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.post, path: "/mail/\(encodedId)/unread")
    }

    /// Delete a message
    public func deleteMail(id: String) async throws -> SuccessResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.delete, path: "/mail/\(encodedId)")
    }
}

// MARK: - Agents Endpoints

extension APIClient {
    /// Get all agents as CrewMember list
    public func getAgents() async throws -> [CrewMember] {
        try await requestWithEnvelope(.get, path: "/agents")
    }

    /// Spawn a new agent session for a project
    public func spawnPolecat(projectPath: String, callsign: String? = nil) async throws -> SpawnPolecatResponse {
        let request = SpawnPolecatRequest(projectPath: projectPath, callsign: callsign)
        return try await requestWithEnvelope(.post, path: "/agents/spawn-polecat", body: request)
    }

    /// Capture polecat terminal content
    public func getPolecatTerminal(rig: String, polecat: String) async throws -> TerminalCapture {
        let encodedRig = rig.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? rig
        let encodedPolecat = polecat.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? polecat
        return try await requestWithEnvelope(
            .get,
            path: "/agents/\(encodedRig)/\(encodedPolecat)/terminal",
            timeout: configuration.terminalTimeout
        )
    }
}

// MARK: - Sessions Endpoints

extension APIClient {
    /// List all managed sessions
    public func getSessions() async throws -> [ManagedSession] {
        try await requestWithEnvelope(.get, path: "/sessions")
    }

    /// Get a single session by ID
    public func getSession(id: String) async throws -> ManagedSession {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/sessions/\(encodedId)")
    }

    /// Create a new session
    public func createSession(_ request: CreateSessionRequest) async throws -> ManagedSession {
        try await requestWithEnvelope(.post, path: "/sessions", body: request)
    }

    /// Kill a session
    public func killSession(id: String) async throws -> KillSessionResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.delete, path: "/sessions/\(encodedId)")
    }

    /// Send text input to a session's terminal
    public func sendSessionInput(id: String, text: String) async throws -> SendSessionInputResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = SendSessionInputRequest(text: text)
        return try await requestWithEnvelope(.post, path: "/sessions/\(encodedId)/input", body: request)
    }

    /// Trigger session discovery
    public func discoverSessions() async throws -> DiscoverSessionsResponse {
        try await requestWithEnvelope(.post, path: "/sessions/discover")
    }

    /// Get all StarCraft callsigns with availability status
    public func getCallsigns() async throws -> [Callsign] {
        try await requestWithEnvelope(.get, path: "/sessions/callsigns")
    }
}

// MARK: - Swarms Endpoints

extension APIClient {
    /// List all swarms
    public func getSwarms() async throws -> [SwarmInfo] {
        try await requestWithEnvelope(.get, path: "/swarms")
    }

    /// Get swarm status with live agent info
    public func getSwarm(id: String) async throws -> SwarmInfo {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/swarms/\(encodedId)")
    }

    /// Create a new swarm
    public func createSwarm(_ request: CreateSwarmRequest) async throws -> SwarmInfo {
        try await requestWithEnvelope(.post, path: "/swarms", body: request)
    }

    /// Add an agent to a swarm
    public func addAgentToSwarm(id: String, name: String? = nil) async throws -> SwarmAgent {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = AddSwarmAgentRequest(name: name)
        return try await requestWithEnvelope(.post, path: "/swarms/\(encodedId)/agents", body: request)
    }

    /// Remove an agent from a swarm
    public func removeAgentFromSwarm(id: String, sessionId: String, removeWorktree: Bool = false) async throws -> RemoveAgentResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let encodedSession = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        var queryItems: [URLQueryItem] = []
        if removeWorktree {
            queryItems.append(URLQueryItem(name: "removeWorktree", value: "true"))
        }
        return try await requestWithEnvelope(
            .delete,
            path: "/swarms/\(encodedId)/agents/\(encodedSession)",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Get branch status for all agents in a swarm
    public func getSwarmBranches(id: String) async throws -> [BranchStatus] {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/swarms/\(encodedId)/branches")
    }

    /// Merge an agent's branch back into main
    public func mergeSwarmBranch(id: String, branch: String) async throws -> MergeResult {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = MergeBranchRequest(branch: branch)
        return try await requestWithEnvelope(.post, path: "/swarms/\(encodedId)/merge", body: request)
    }

    /// Destroy a swarm
    public func destroySwarm(id: String, removeWorktrees: Bool = true) async throws -> DestroySwarmResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        var queryItems: [URLQueryItem] = []
        if !removeWorktrees {
            queryItems.append(URLQueryItem(name: "removeWorktrees", value: "false"))
        }
        return try await requestWithEnvelope(
            .delete,
            path: "/swarms/\(encodedId)",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }
}

// MARK: - Permissions Endpoints

extension APIClient {
    /// Get current permission configuration
    public func getPermissionConfig() async throws -> PermissionConfigResponse {
        try await requestWithEnvelope(.get, path: "/permissions")
    }

    /// Update permission configuration
    public func updatePermissionConfig(_ update: PermissionConfigUpdate) async throws -> PermissionConfigResponse {
        try await requestWithEnvelope(.patch, path: "/permissions", body: update)
    }

    /// Get effective permission mode for a session
    public func getSessionPermissionMode(sessionId: String) async throws -> SessionPermissionMode {
        let encodedId = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        return try await requestWithEnvelope(.get, path: "/permissions/\(encodedId)")
    }
}

// MARK: - Projects Endpoints

extension APIClient {
    /// List all registered projects
    public func getProjects() async throws -> [Project] {
        try await requestWithEnvelope(.get, path: "/projects")
    }

    /// Get a single project by ID
    public func getProject(id: String) async throws -> Project {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/projects/\(encodedId)")
    }

    /// Create a new project (from path, clone URL, or empty)
    public func createProject(_ request: CreateProjectRequest) async throws -> Project {
        try await requestWithEnvelope(.post, path: "/projects", body: request)
    }

    /// Activate a project as the current project
    public func activateProject(id: String) async throws -> Project {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.post, path: "/projects/\(encodedId)/activate")
    }

    /// Delete a project registration (does not delete files)
    public func deleteProject(id: String) async throws -> DeleteProjectResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.delete, path: "/projects/\(encodedId)")
    }

    /// Discover local projects from the server's working directory
    public func discoverProjects() async throws -> DiscoverProjectsResponse {
        try await requestWithEnvelope(.post, path: "/projects/discover")
    }
}

// MARK: - Project Overview Endpoints

extension APIClient {
    /// Get aggregated project overview (beads, epics, agents) in a single request.
    ///
    /// - Parameter projectId: The project ID to fetch overview for.
    /// - Returns: A ``ProjectOverviewResponse`` with beads, epics, and agent summaries.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getProjectOverview(projectId: String) async throws -> ProjectOverviewResponse {
        let encodedId = projectId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? projectId
        return try await requestWithEnvelope(.get, path: "/projects/\(encodedId)/overview")
    }
}

// MARK: - Convoys Endpoints

extension APIClient {
    /// Get active convoys
    public func getConvoys() async throws -> [Convoy] {
        try await requestWithEnvelope(.get, path: "/convoys")
    }
}

// MARK: - Beads Endpoints

extension APIClient {
    /// Bead status filter options
    public enum BeadStatusFilter: String {
        case `default`
        case open
        case hooked
        case inProgress = "in_progress"
        case blocked
        case deferred
        case closed
        case all
    }

    /// List beads with filtering
    public func getBeads(
        rig: String? = nil,
        status: BeadStatusFilter? = nil,
        type: String? = nil,
        limit: Int? = nil,
        assignee: String? = nil,
        excludeTown: Bool = false
    ) async throws -> [BeadInfo] {
        var queryItems: [URLQueryItem] = []

        if let rig {
            queryItems.append(URLQueryItem(name: "rig", value: rig))
        }
        if let status {
            queryItems.append(URLQueryItem(name: "status", value: status.rawValue))
        }
        if let type {
            queryItems.append(URLQueryItem(name: "type", value: type))
        }
        if let limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let assignee {
            queryItems.append(URLQueryItem(name: "assignee", value: assignee))
        }
        if excludeTown {
            queryItems.append(URLQueryItem(name: "excludeTown", value: "true"))
        }

        return try await requestWithEnvelope(
            .get,
            path: "/beads",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Get detailed information about a single bead.
    ///
    /// Returns full bead data including description, dependencies, and metadata.
    ///
    /// - Parameter id: Full bead ID (e.g., "hq-vts8", "adj-67tta")
    /// - Returns: A ``BeadDetail`` with complete bead information.
    /// - Throws: ``APIClientError`` if the request fails or bead is not found.
    public func getBeadDetail(id: String) async throws -> BeadDetail {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/beads/\(encodedId)")
    }

    /// List available bead sources (projects/rigs with beads databases)
    public func getBeadSources() async throws -> BeadSourcesResponse {
        try await requestWithEnvelope(.get, path: "/beads/sources")
    }

    /// Update a bead's status (e.g., for Kanban drag-and-drop)
    ///
    /// Updates the status of a bead in its source database.
    ///
    /// ## Example
    /// ```swift
    /// // Move bead to in_progress
    /// let result = try await client.updateBeadStatus(id: "hq-vts8", status: "in_progress")
    /// print("Bead \(result.id) is now \(result.status)")
    /// ```
    ///
    /// - Parameters:
    ///   - id: Full bead ID (e.g., "hq-vts8", "gb-53tj")
    ///   - status: New status value (open, in_progress, blocked, closed, etc.)
    /// - Returns: A ``BeadUpdateResponse`` confirming the update.
    /// - Throws: ``APIClientError`` if the request fails or status is invalid.
    public func updateBeadStatus(id: String, status: String) async throws -> BeadUpdateResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = BeadStatusUpdateRequest(status: status)
        return try await requestWithEnvelope(.patch, path: "/beads/\(encodedId)", body: request)
    }

    /// Assign a bead to an agent.
    ///
    /// ## Example
    /// ```swift
    /// let result = try await client.assignBead(id: "hq-vts8", assignee: "adjutant/polecats/toast")
    /// print("Bead \(result.id) assigned to \(result.assignee ?? "unknown")")
    /// ```
    ///
    /// - Parameters:
    ///   - id: Full bead ID (e.g., "hq-vts8", "gb-53tj")
    ///   - assignee: Agent identifier to assign the bead to
    /// - Returns: A ``BeadUpdateResponse`` confirming the assignment.
    /// - Throws: ``APIClientError`` if the request fails.
    public func assignBead(id: String, assignee: String) async throws -> BeadUpdateResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = BeadAssignRequest(assignee: assignee)
        return try await requestWithEnvelope(.patch, path: "/beads/\(encodedId)", body: request)
    }

    /// Get recently closed beads within a time window.
    ///
    /// Fetches beads that were closed within the specified number of hours.
    /// This endpoint may not be available on all backends; callers should
    /// handle errors gracefully and fall back to an empty array.
    ///
    /// - Parameter hours: Number of hours to look back (default: 1)
    /// - Returns: Array of recently closed ``BeadInfo`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getRecentlyClosedBeads(hours: Int = 1) async throws -> [BeadInfo] {
        let queryItems = [URLQueryItem(name: "hours", value: String(hours))]
        return try await requestWithEnvelope(
            .get,
            path: "/beads/recent-closed",
            queryItems: queryItems
        )
    }

    /// Get the beads dependency graph for visualization.
    ///
    /// Returns nodes (beads) and edges (dependency relationships) suitable
    /// for rendering a dependency graph.
    ///
    /// - Returns: A ``BeadsGraphResponse`` containing nodes and edges.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getBeadsGraph() async throws -> BeadsGraphResponse {
        try await requestWithEnvelope(.get, path: "/beads/graph")
    }

    /// Get children of an epic using the dependency graph.
    ///
    /// Uses the backend's `bd children` command to resolve sub-beads via
    /// the dependency graph instead of hierarchical ID pattern matching.
    ///
    /// - Parameter epicId: Full epic bead ID (e.g., "adj-020")
    /// - Returns: Array of child ``BeadInfo`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getEpicChildren(epicId: String) async throws -> [BeadInfo] {
        let encodedId = epicId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? epicId
        return try await requestWithEnvelope(.get, path: "/beads/\(encodedId)/children")
    }

    /// List epics with server-computed progress using the dependency graph.
    ///
    /// Returns epics with totalCount, closedCount, and progress fields
    /// computed server-side. Eliminates the need to fetch all beads client-side.
    ///
    /// - Parameter status: Optional status filter (default: "all")
    /// - Returns: Array of ``EpicWithProgressResponse`` items.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getEpicsWithProgress(status: String = "all") async throws -> [EpicWithProgressResponse] {
        let queryItems = [URLQueryItem(name: "status", value: status)]
        return try await requestWithEnvelope(
            .get,
            path: "/beads/epics-with-progress",
            queryItems: queryItems
        )
    }
}

// MARK: - Tunnel Endpoints

extension APIClient {
    /// Get current ngrok tunnel status
    public func getTunnelStatus() async throws -> TunnelStatus {
        try await requestWithEnvelope(.get, path: "/tunnel/status")
    }

    /// Start the ngrok tunnel
    public func startTunnel() async throws -> TunnelStartResponse {
        try await requestWithEnvelope(.post, path: "/tunnel/start")
    }

    /// Stop the ngrok tunnel
    public func stopTunnel() async throws -> TunnelStopResponse {
        try await requestWithEnvelope(.post, path: "/tunnel/stop")
    }
}

// MARK: - Mode Endpoints

extension APIClient {
    /// Get current deployment mode info including features and available transitions.
    ///
    /// ## Example
    /// ```swift
    /// let modeInfo = try await client.getMode()
    /// print("Mode: \(modeInfo.mode)")
    /// print("Features: \(modeInfo.features)")
    /// ```
    ///
    /// - Returns: A ``ModeInfo`` containing the current mode, features, and available modes.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getMode() async throws -> ModeInfo {
        try await requestWithEnvelope(.get, path: "/mode")
    }

    /// Switch deployment mode at runtime.
    ///
    /// ## Example
    /// ```swift
    /// let result = try await client.switchMode(to: "swarm")
    /// print("Switched to: \(result.mode)")
    /// ```
    ///
    /// - Parameter mode: The target mode ("gastown" or "swarm").
    /// - Returns: A ``ModeInfo`` containing the new mode state.
    /// - Throws: ``APIClientError`` if the request fails or mode is unavailable.
    public func switchMode(to mode: String) async throws -> ModeInfo {
        try await requestWithEnvelope(.post, path: "/mode", body: SwitchModeRequest(mode: mode))
    }
}

// MARK: - Voice Endpoints

extension APIClient {
    /// Check if voice service is available
    public func getVoiceStatus() async throws -> VoiceStatus {
        try await requestWithEnvelope(.get, path: "/voice/status")
    }

    /// Get global voice configuration
    public func getVoiceConfig() async throws -> VoiceConfigResponse {
        try await requestWithEnvelope(.get, path: "/voice/config")
    }

    /// Synthesize text to speech
    public func synthesizeSpeech(_ request: SynthesizeRequest) async throws -> SynthesizeResponse {
        try await requestWithEnvelope(
            .post,
            path: "/voice/synthesize",
            body: request,
            timeout: configuration.voiceTimeout
        )
    }

    /// Get cached audio file
    public func getAudioFile(filename: String) async throws -> Data {
        let encodedFilename = filename.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? filename
        let (data, _) = try await requestData(.get, path: "/voice/audio/\(encodedFilename)")
        return data
    }

    /// Transcribe audio to text
    public func transcribeAudio(_ audioData: Data, contentType: String = "audio/webm") async throws -> TranscriptionResponse {
        let (data, _) = try await requestData(
            .post,
            path: "/voice/transcribe",
            body: audioData,
            contentType: contentType,
            timeout: configuration.voiceTimeout
        )

        let envelope = try JSONDecoder().decode(ApiResponse<TranscriptionResponse>.self, from: data)
        guard envelope.success, let result = envelope.data else {
            if let error = envelope.error {
                throw APIClientError.serverError(error)
            }
            throw APIClientError.decodingError("Transcription failed without error")
        }
        return result
    }

    /// Get notification settings
    public func getNotificationSettings() async throws -> NotificationSettings {
        try await requestWithEnvelope(.get, path: "/voice/settings")
    }

    /// Update notification settings
    public func updateNotificationSettings(_ settings: NotificationSettings) async throws -> NotificationSettings {
        try await requestWithEnvelope(.put, path: "/voice/settings", body: settings)
    }

    /// Synthesize notification audio
    public func synthesizeNotification(_ request: NotificationRequest) async throws -> NotificationResponse {
        try await requestWithEnvelope(.post, path: "/voice/notification", body: request)
    }

    /// Get agent's voice configuration
    public func getAgentVoiceConfig(agentId: String) async throws -> AgentVoiceConfig {
        let encodedId = agentId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? agentId
        return try await requestWithEnvelope(.get, path: "/voice/config/\(encodedId)")
    }

    /// Set agent's voice configuration
    public func setAgentVoiceConfig(agentId: String, config: AgentVoiceConfigUpdate) async throws -> AgentVoiceConfig {
        let encodedId = agentId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? agentId
        return try await requestWithEnvelope(.put, path: "/voice/config/\(encodedId)", body: config)
    }

    /// Delete agent's custom voice configuration
    public func deleteAgentVoiceConfig(agentId: String) async throws -> SuccessResponse {
        let encodedId = agentId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? agentId
        return try await requestWithEnvelope(.delete, path: "/voice/config/\(encodedId)")
    }

    /// List all agents with custom voice configurations
    public func getAgentVoiceConfigs() async throws -> [AgentVoiceConfig] {
        try await requestWithEnvelope(.get, path: "/voice/agents")
    }

    /// Get default voice configuration
    public func getDefaultVoiceConfig() async throws -> DefaultVoiceConfig {
        try await requestWithEnvelope(.get, path: "/voice/defaults")
    }

    /// Set default voice configuration
    public func setDefaultVoiceConfig(_ config: AgentVoiceConfigUpdate) async throws -> DefaultVoiceConfig {
        try await requestWithEnvelope(.put, path: "/voice/defaults", body: config)
    }
}
