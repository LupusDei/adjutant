import Foundation

/// Supported device platforms for push notifications.
public enum DevicePlatform: String, Codable, CaseIterable, Sendable {
    case ios
    case macos
}

/// A registered device token for push notifications.
public struct DeviceToken: Codable, Equatable, Sendable {
    /// The APNs device token (hex string)
    public let token: String
    /// Device platform
    public let platform: DevicePlatform
    /// Agent this device is associated with (optional)
    public let agentId: String?
    /// Bundle ID of the app
    public let bundleId: String
    /// ISO 8601 timestamp when token was registered
    public let registeredAt: String
    /// ISO 8601 timestamp when token was last seen
    public let lastSeenAt: String

    public init(
        token: String,
        platform: DevicePlatform,
        agentId: String? = nil,
        bundleId: String,
        registeredAt: String,
        lastSeenAt: String
    ) {
        self.token = token
        self.platform = platform
        self.agentId = agentId
        self.bundleId = bundleId
        self.registeredAt = registeredAt
        self.lastSeenAt = lastSeenAt
    }
}

/// Request payload for registering a device token.
public struct RegisterDeviceTokenRequest: Codable, Equatable, Sendable {
    /// The APNs device token (hex string)
    public let token: String
    /// Device platform
    public let platform: DevicePlatform
    /// Agent this device is associated with (optional)
    public let agentId: String?
    /// Bundle ID of the app (optional, uses server default if not provided)
    public let bundleId: String?

    public init(
        token: String,
        platform: DevicePlatform,
        agentId: String? = nil,
        bundleId: String? = nil
    ) {
        self.token = token
        self.platform = platform
        self.agentId = agentId
        self.bundleId = bundleId
    }
}

/// Response from device token registration.
public struct RegisterDeviceTokenResponse: Codable, Equatable, Sendable {
    /// Whether this was a new registration or update
    public let isNew: Bool
    /// The registered device token
    public let token: DeviceToken

    public init(isNew: Bool, token: DeviceToken) {
        self.isNew = isNew
        self.token = token
    }
}

/// APNs service status response.
public struct APNsStatus: Codable, Equatable, Sendable {
    /// Whether APNs is configured on the server
    public let configured: Bool
    /// APNs environment (development or production)
    public let environment: String?
    /// App bundle ID configured on server
    public let bundleId: String?

    public init(configured: Bool, environment: String? = nil, bundleId: String? = nil) {
        self.configured = configured
        self.environment = environment
        self.bundleId = bundleId
    }
}

/// Response for device deletion.
public struct DeviceDeleteResponse: Codable, Equatable, Sendable {
    public let deleted: Bool

    public init(deleted: Bool = true) {
        self.deleted = deleted
    }
}
