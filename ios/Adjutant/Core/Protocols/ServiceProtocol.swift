import Foundation

/// Protocol defining the base interface for all services in the application.
/// Services encapsulate business logic and data operations, providing a clean
/// abstraction layer between ViewModels and data sources.
public protocol ServiceProtocol {
    /// The type of error this service can throw
    associatedtype ServiceError: Error

    /// Whether the service is currently available
    var isAvailable: Bool { get async }
}

/// Common error types that services can use
enum ServiceError: LocalizedError {
    case networkUnavailable
    case invalidResponse
    case decodingFailed(Error)
    case serverError(statusCode: Int, message: String?)
    case unauthorized
    case notFound
    case timeout
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .networkUnavailable:
            return "Network connection unavailable"
        case .invalidResponse:
            return "Invalid response from server"
        case .decodingFailed(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .serverError(let statusCode, let message):
            return message ?? "Server error (status: \(statusCode))"
        case .unauthorized:
            return "Unauthorized access"
        case .notFound:
            return "Resource not found"
        case .timeout:
            return "Request timed out"
        case .unknown(let error):
            return error.localizedDescription
        }
    }
}
