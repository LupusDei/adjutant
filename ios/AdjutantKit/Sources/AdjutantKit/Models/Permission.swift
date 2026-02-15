import Foundation

/// Permission configuration from the backend.
public struct PermissionConfigResponse: Codable, Equatable {
    public let defaultMode: String
    public let sessions: [String: String]
    public let toolOverrides: [String: String]

    public init(defaultMode: String, sessions: [String: String] = [:], toolOverrides: [String: String] = [:]) {
        self.defaultMode = defaultMode
        self.sessions = sessions
        self.toolOverrides = toolOverrides
    }
}

/// Request body for updating permission config.
public struct PermissionConfigUpdate: Encodable {
    public let defaultMode: String?
    public let sessions: [String: String]?
    public let toolOverrides: [String: String]?

    public init(defaultMode: String? = nil, sessions: [String: String]? = nil, toolOverrides: [String: String]? = nil) {
        self.defaultMode = defaultMode
        self.sessions = sessions
        self.toolOverrides = toolOverrides
    }
}

/// Effective permission mode for a specific session.
public struct SessionPermissionMode: Codable, Equatable {
    public let sessionId: String
    public let mode: String
}
