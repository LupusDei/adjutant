import Foundation

// MARK: - Status Endpoints

extension APIClient {
    /// Retrieves the current system status.
    ///
    /// - Returns: A ``SystemStatus`` containing workspace info, agents, and timestamp.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getStatus() async throws -> SystemStatus {
        try await requestWithEnvelope(.get, path: "/status")
    }
}

// MARK: - Agents Endpoints

extension APIClient {
    /// Get all agents as CrewMember list
    public func getAgents() async throws -> [CrewMember] {
        try await requestWithEnvelope(.get, path: "/agents")
    }

    /// Spawn a new agent session
    public func spawnAgent(projectPath: String? = nil, projectId: String? = nil, callsign: String? = nil) async throws -> SpawnAgentResponse {
        let request = SpawnAgentRequest(projectPath: projectPath, projectId: projectId, callsign: callsign)
        return try await requestWithEnvelope(.post, path: "/agents/spawn", body: request)
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
    public func getProjectOverview(projectId: String) async throws -> ProjectOverviewResponse {
        let encodedId = projectId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? projectId
        return try await requestWithEnvelope(.get, path: "/projects/\(encodedId)/overview")
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
        case deferred
        case closed
        case all
    }

    /// List beads with filtering
    public func getBeads(
        status: BeadStatusFilter? = nil,
        type: String? = nil,
        limit: Int? = nil,
        assignee: String? = nil,
        sort: String? = nil,
        order: String? = nil
    ) async throws -> [BeadInfo] {
        var queryItems: [URLQueryItem] = []

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
        if let sort {
            queryItems.append(URLQueryItem(name: "sort", value: sort))
        }
        if let order {
            queryItems.append(URLQueryItem(name: "order", value: order))
        }

        return try await requestWithEnvelope(
            .get,
            path: "/beads",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
    }

    /// Get detailed information about a single bead.
    public func getBeadDetail(id: String) async throws -> BeadDetail {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/beads/\(encodedId)")
    }

    /// List available bead sources (projects with beads databases)
    public func getBeadSources() async throws -> BeadSourcesResponse {
        try await requestWithEnvelope(.get, path: "/beads/sources")
    }

    /// Update a bead's status
    public func updateBeadStatus(id: String, status: String) async throws -> BeadUpdateResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = BeadStatusUpdateRequest(status: status)
        return try await requestWithEnvelope(.patch, path: "/beads/\(encodedId)", body: request)
    }

    /// Assign a bead to an agent.
    public func assignBead(id: String, assignee: String) async throws -> BeadUpdateResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let request = BeadAssignRequest(assignee: assignee)
        return try await requestWithEnvelope(.patch, path: "/beads/\(encodedId)", body: request)
    }

    /// Get recently closed beads within a time window.
    public func getRecentlyClosedBeads(hours: Int = 1) async throws -> [BeadInfo] {
        let queryItems = [URLQueryItem(name: "hours", value: String(hours))]
        return try await requestWithEnvelope(
            .get,
            path: "/beads/recent-closed",
            queryItems: queryItems
        )
    }

    /// Get the beads dependency graph for visualization.
    public func getBeadsGraph() async throws -> BeadsGraphResponse {
        try await requestWithEnvelope(.get, path: "/beads/graph")
    }

    /// Get children of an epic using the dependency graph.
    public func getEpicChildren(epicId: String) async throws -> [BeadInfo] {
        let encodedId = epicId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? epicId
        return try await requestWithEnvelope(.get, path: "/beads/\(encodedId)/children")
    }

    /// List epics with server-computed progress using the dependency graph.
    public func getEpicsWithProgress(status: String = "all") async throws -> [EpicWithProgressResponse] {
        let queryItems = [URLQueryItem(name: "status", value: status)]
        return try await requestWithEnvelope(
            .get,
            path: "/beads/epics-with-progress",
            queryItems: queryItems
        )
    }
}

// MARK: - Dashboard Endpoints

extension APIClient {
    /// Fetch all dashboard data in a single request.
    public func getDashboard() async throws -> DashboardResponse {
        try await requestWithEnvelope(.get, path: "/dashboard")
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
