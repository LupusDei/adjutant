import Foundation

/// Possible tunnel states
public enum TunnelState: String, Codable, CaseIterable {
    case stopped
    case starting
    case running
    case error
}

/// Tunnel status response
public struct TunnelStatus: Codable, Equatable {
    public let state: TunnelState
    public let publicUrl: String?
    public let error: String?

    public init(state: TunnelState, publicUrl: String? = nil, error: String? = nil) {
        self.state = state
        self.publicUrl = publicUrl
        self.error = error
    }
}

/// Response for starting the tunnel
public struct TunnelStartResponse: Codable, Equatable {
    public let state: TunnelState
    public let publicUrl: String?

    public init(state: TunnelState, publicUrl: String? = nil) {
        self.state = state
        self.publicUrl = publicUrl
    }
}

/// Response for stopping the tunnel
public struct TunnelStopResponse: Codable, Equatable {
    public let state: TunnelState

    public init(state: TunnelState = .stopped) {
        self.state = state
    }
}
