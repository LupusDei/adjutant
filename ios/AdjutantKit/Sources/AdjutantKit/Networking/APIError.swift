import Foundation

/// Errors that can occur during API requests
public enum APIClientError: Error, Equatable {
    /// Network connectivity error
    case networkError(String)
    /// Server returned an error response
    case serverError(ApiError)
    /// Failed to decode the response
    case decodingError(String)
    /// Request timed out
    case timeout
    /// Invalid URL or request configuration
    case invalidRequest(String)
    /// Request was cancelled
    case cancelled
    /// HTTP error with status code
    case httpError(statusCode: Int, message: String)
    /// Rate limited - should retry after delay
    case rateLimited(retryAfter: TimeInterval?)
    /// Unauthorized - invalid or missing API key (401)
    case unauthorized

    public var isRetryable: Bool {
        switch self {
        case .networkError, .timeout, .rateLimited:
            return true
        case .serverError(let apiError):
            return apiError.code == ApiErrorCode.internalError.rawValue ||
                   apiError.code == ApiErrorCode.timeout.rawValue
        case .httpError(let statusCode, _):
            return statusCode >= 500 || statusCode == 429
        case .decodingError, .invalidRequest, .cancelled, .unauthorized:
            return false
        }
    }

    public var localizedDescription: String {
        switch self {
        case .networkError(let message):
            return "Network error: \(message)"
        case .serverError(let error):
            return "Server error: \(error.message)"
        case .decodingError(let message):
            return "Decoding error: \(message)"
        case .timeout:
            return "Request timed out"
        case .invalidRequest(let message):
            return "Invalid request: \(message)"
        case .cancelled:
            return "Request was cancelled"
        case .httpError(let statusCode, let message):
            return "HTTP \(statusCode): \(message)"
        case .rateLimited(let retryAfter):
            if let delay = retryAfter {
                return "Rate limited. Retry after \(Int(delay)) seconds"
            }
            return "Rate limited"
        case .unauthorized:
            return "Unauthorized. Check your API key."
        }
    }
}

extension APIClientError: LocalizedError {
    public var errorDescription: String? {
        localizedDescription
    }
}
