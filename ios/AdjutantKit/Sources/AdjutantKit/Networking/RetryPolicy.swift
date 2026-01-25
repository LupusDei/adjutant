import Foundation

/// Configuration for retry behavior
public struct RetryPolicy: Sendable {
    /// Maximum number of retry attempts
    public let maxAttempts: Int
    /// Base delay between retries in seconds
    public let baseDelay: TimeInterval
    /// Maximum delay between retries in seconds
    public let maxDelay: TimeInterval
    /// Multiplier for exponential backoff
    public let multiplier: Double
    /// Optional jitter factor (0.0 - 1.0) to add randomness
    public let jitter: Double

    public init(
        maxAttempts: Int = 3,
        baseDelay: TimeInterval = 1.0,
        maxDelay: TimeInterval = 30.0,
        multiplier: Double = 2.0,
        jitter: Double = 0.1
    ) {
        self.maxAttempts = maxAttempts
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
        self.multiplier = multiplier
        self.jitter = jitter
    }

    /// Calculate delay for a given attempt number (0-indexed)
    public func delay(forAttempt attempt: Int) -> TimeInterval {
        let exponentialDelay = baseDelay * pow(multiplier, Double(attempt))
        let clampedDelay = min(exponentialDelay, maxDelay)

        // Add jitter
        let jitterRange = clampedDelay * jitter
        let jitterOffset = Double.random(in: -jitterRange...jitterRange)

        return max(0, clampedDelay + jitterOffset)
    }

    /// Default retry policy
    public static let `default` = RetryPolicy()

    /// Aggressive retry policy for critical requests
    public static let aggressive = RetryPolicy(
        maxAttempts: 5,
        baseDelay: 0.5,
        maxDelay: 60.0,
        multiplier: 2.0,
        jitter: 0.2
    )

    /// No retries
    public static let none = RetryPolicy(maxAttempts: 0)
}

/// Executor for retry logic with exponential backoff
actor RetryExecutor {
    private let policy: RetryPolicy

    public init(policy: RetryPolicy = .default) {
        self.policy = policy
    }

    /// Execute an operation with retry logic
    public func execute<T: Sendable>(
        operation: @Sendable () async throws -> T,
        shouldRetry: @Sendable (Error) -> Bool = { error in
            if let apiError = error as? APIClientError {
                return apiError.isRetryable
            }
            return false
        }
    ) async throws -> T {
        var lastError: Error?

        for attempt in 0...policy.maxAttempts {
            do {
                return try await operation()
            } catch {
                lastError = error

                // Check if we should retry
                guard attempt < policy.maxAttempts && shouldRetry(error) else {
                    throw error
                }

                // Calculate delay
                var delay = policy.delay(forAttempt: attempt)

                // Handle rate limiting with specific retry-after
                if let apiError = error as? APIClientError,
                   case .rateLimited(let retryAfter) = apiError,
                   let retryDelay = retryAfter {
                    delay = retryDelay
                }

                // Wait before retry
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

                #if DEBUG
                APILogger.shared.log(.debug, "Retrying request (attempt \(attempt + 2)/\(policy.maxAttempts + 1)) after \(String(format: "%.2f", delay))s delay")
                #endif
            }
        }

        throw lastError ?? APIClientError.networkError("Unknown error after retries")
    }
}
