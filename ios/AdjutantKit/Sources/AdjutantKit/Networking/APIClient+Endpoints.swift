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

    /// Request polecat spawn for a rig
    public func spawnPolecat(rig: String) async throws -> SpawnPolecatResponse {
        let request = SpawnPolecatRequest(rig: rig)
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
        if excludeTown {
            queryItems.append(URLQueryItem(name: "excludeTown", value: "true"))
        }

        return try await requestWithEnvelope(
            .get,
            path: "/beads",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
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
