import Foundation

/// Information about an available deployment mode
public struct AvailableMode: Codable, Equatable {
    /// The mode identifier
    public let mode: String
    /// Whether this mode can be activated
    public let available: Bool
    /// Reason the mode is unavailable (nil if available)
    public let reason: String?

    public init(mode: String, available: Bool, reason: String? = nil) {
        self.mode = mode
        self.available = available
        self.reason = reason
    }
}

/// Current deployment mode information from the backend
public struct ModeInfo: Codable, Equatable {
    /// Current deployment mode ("gastown" or "swarm")
    public let mode: String
    /// Features available in this mode
    public let features: [String]
    /// Available modes and their transition availability
    public let availableModes: [AvailableMode]

    public init(mode: String, features: [String], availableModes: [AvailableMode]) {
        self.mode = mode
        self.features = features
        self.availableModes = availableModes
    }
}

/// Request body for switching deployment mode
public struct SwitchModeRequest: Codable, Equatable {
    public let mode: String

    public init(mode: String) {
        self.mode = mode
    }
}

/// SSE event payload for mode_changed events
public struct ModeChangedEvent: Codable, Equatable {
    /// The new mode
    public let mode: String
    /// Features available in the new mode
    public let features: [String]
    /// Reason for the change
    public let reason: String?

    public init(mode: String, features: [String], reason: String? = nil) {
        self.mode = mode
        self.features = features
        self.reason = reason
    }
}
