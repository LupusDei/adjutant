import Foundation

// MARK: - Status Endpoints

extension APIClient {
    /// Get current Gastown system status
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
    /// Mail filter options
    public enum MailFilter: String {
        case user
        case infrastructure
    }

    /// List all mail messages
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

    /// Send a new message
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
