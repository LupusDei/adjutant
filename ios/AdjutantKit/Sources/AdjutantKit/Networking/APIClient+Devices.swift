import Foundation

// MARK: - Device Token Endpoints

extension APIClient {
    /// Registers a device token for push notifications.
    ///
    /// Call this method after receiving a device token from APNs in
    /// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    ///
    /// ## Example
    /// ```swift
    /// let request = RegisterDeviceTokenRequest(
    ///     token: deviceTokenString,
    ///     platform: .ios
    /// )
    /// let response = try await client.registerDeviceToken(request)
    /// print("Registered: \(response.isNew ? "new" : "updated")")
    /// ```
    ///
    /// - Parameter request: A ``RegisterDeviceTokenRequest`` with token details.
    /// - Returns: A ``RegisterDeviceTokenResponse`` indicating success.
    /// - Throws: ``APIClientError`` if the request fails.
    public func registerDeviceToken(_ request: RegisterDeviceTokenRequest) async throws -> RegisterDeviceTokenResponse {
        try await requestWithEnvelope(.post, path: "/devices/register", body: request)
    }

    /// Unregisters a device token.
    ///
    /// Call this when the user signs out or disables push notifications.
    ///
    /// - Parameter token: The device token to unregister.
    /// - Returns: A ``DeviceDeleteResponse`` confirming deletion.
    /// - Throws: ``APIClientError`` if the request fails.
    public func unregisterDeviceToken(_ token: String) async throws -> DeviceDeleteResponse {
        let encodedToken = token.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? token
        return try await requestWithEnvelope(.delete, path: "/devices/\(encodedToken)")
    }

    /// Gets the APNs service status from the backend.
    ///
    /// Use this to check if APNs is configured on the server before
    /// attempting to register device tokens.
    ///
    /// - Returns: An ``APNsStatus`` with configuration status.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getAPNsStatus() async throws -> APNsStatus {
        try await requestWithEnvelope(.get, path: "/devices/status")
    }
}
