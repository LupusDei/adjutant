/// AdjutantKit - iOS Networking Layer for Adjutant
///
/// This package provides a complete networking layer for the Adjutant iOS app,
/// including all data models, API client, error handling, and retry logic.
///
/// ## Usage
///
/// ```swift
/// import AdjutantKit
///
/// // Create client with default configuration (localhost:4201)
/// let client = APIClient()
///
/// // Or with custom configuration
/// let config = APIClientConfiguration(
///     baseURL: URL(string: "https://api.example.com/api")!,
///     defaultTimeout: 30.0,
///     retryPolicy: .aggressive
/// )
/// let client = APIClient(configuration: config)
///
/// // Make API calls
/// let status = try await client.getStatus()
/// let agents = try await client.getAgents()
/// ```
///
/// ## Models
///
/// - ``ApiResponse``: Generic response wrapper
/// - ``Message``: Mail message
/// - ``CrewMember``: Agent/crew member
/// - ``SystemStatus``: System status
/// - ``BeadInfo``: Issue/task
///
/// ## Error Handling
///
/// All errors are wrapped in ``APIClientError`` which provides:
/// - Network errors
/// - Server errors (from ``ApiError``)
/// - Decoding errors
/// - Timeout handling
/// - Rate limiting
///
/// ## Retry Logic
///
/// The client includes automatic retry with exponential backoff for:
/// - Network errors
/// - Timeouts
/// - Server errors (5xx)
/// - Rate limiting (429)
///
/// Configure via ``RetryPolicy``.

// Re-export all public types

// Models
@_exported import struct Foundation.URL
@_exported import struct Foundation.Data
@_exported import struct Foundation.Date
@_exported import struct Foundation.URLQueryItem
