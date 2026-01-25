import Foundation

/// Generic API response wrapper matching the backend envelope structure.
public struct ApiResponse<T: Decodable>: Decodable {
    /// Whether the request succeeded
    public let success: Bool
    /// Response data (present if success=true)
    public let data: T?
    /// Error information (present if success=false)
    public let error: ApiError?
    /// ISO 8601 response timestamp
    public let timestamp: String

    public init(success: Bool, data: T?, error: ApiError?, timestamp: String) {
        self.success = success
        self.data = data
        self.error = error
        self.timestamp = timestamp
    }
}

/// API error structure returned when success=false
public struct ApiError: Decodable, Error, Equatable {
    /// Error code identifier
    public let code: String
    /// Human-readable error message
    public let message: String
    /// Additional error details
    public let details: String?

    public init(code: String, message: String, details: String? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }
}

/// Known API error codes
public enum ApiErrorCode: String, CaseIterable {
    case validationError = "VALIDATION_ERROR"
    case notFound = "NOT_FOUND"
    case alreadyRunning = "ALREADY_RUNNING"
    case alreadyStopped = "ALREADY_STOPPED"
    case internalError = "INTERNAL_ERROR"
    case voiceNotAvailable = "VOICE_NOT_AVAILABLE"
    case timeout = "TIMEOUT"
    case networkError = "NETWORK_ERROR"
    case rateLimited = "RATE_LIMITED"
    case synthesisError = "SYNTHESIS_ERROR"
    case invalidFilename = "INVALID_FILENAME"
    case invalidAudio = "INVALID_AUDIO"
    case transcriptionError = "TRANSCRIPTION_ERROR"
}

/// Paginated response wrapper
public struct PaginatedResponse<T: Decodable>: Decodable {
    public let items: [T]
    public let total: Int
    public let hasMore: Bool

    public init(items: [T], total: Int, hasMore: Bool) {
        self.items = items
        self.total = total
        self.hasMore = hasMore
    }
}
