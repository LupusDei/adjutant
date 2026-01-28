import Foundation

/// HTTP methods supported by the API client
public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
    case patch = "PATCH"
}

/// Configuration for the API client
public struct APIClientConfiguration: Sendable {
    /// Base URL for API requests (e.g., "http://localhost:3001/api")
    public let baseURL: URL
    /// API key for authentication (optional)
    public let apiKey: String?
    /// Default timeout for requests
    public let defaultTimeout: TimeInterval
    /// Timeout for terminal polling (shorter)
    public let terminalTimeout: TimeInterval
    /// Timeout for voice synthesis (longer)
    public let voiceTimeout: TimeInterval
    /// Default retry policy
    public let retryPolicy: RetryPolicy

    public init(
        baseURL: URL,
        apiKey: String? = nil,
        defaultTimeout: TimeInterval = 30.0,
        terminalTimeout: TimeInterval = 10.0,
        voiceTimeout: TimeInterval = 60.0,
        retryPolicy: RetryPolicy = .default
    ) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.defaultTimeout = defaultTimeout
        self.terminalTimeout = terminalTimeout
        self.voiceTimeout = voiceTimeout
        self.retryPolicy = retryPolicy
    }

    /// Development configuration
    public static var development: APIClientConfiguration {
        APIClientConfiguration(
            baseURL: URL(string: "http://localhost:3001/api")!
        )
    }
}

/// Main API client for communicating with the Adjutant backend
public actor APIClient {
    /// Client configuration (internal for extension access)
    let configuration: APIClientConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private let retryExecutor: RetryExecutor

    public init(configuration: APIClientConfiguration, urlSessionConfiguration: URLSessionConfiguration? = nil) {
        self.configuration = configuration

        let sessionConfig = urlSessionConfiguration ?? URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = configuration.defaultTimeout
        sessionConfig.timeoutIntervalForResource = configuration.defaultTimeout * 2
        self.session = URLSession(configuration: sessionConfig)

        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()

        self.retryExecutor = RetryExecutor(policy: configuration.retryPolicy)
    }

    /// Initializer for development
    public init() {
        self.init(configuration: .development)
    }

    // MARK: - Core Request Methods

    /// Perform a request and decode the response
    public func request<T: Decodable>(
        _ method: HTTPMethod,
        path: String,
        queryItems: [URLQueryItem]? = nil,
        body: (any Encodable)? = nil,
        timeout: TimeInterval? = nil,
        retryPolicy: RetryPolicy? = nil
    ) async throws -> T {
        let url = try buildURL(path: path, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.timeoutInterval = timeout ?? configuration.defaultTimeout

        // Set headers
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add API key header if configured
        if let apiKey = configuration.apiKey, !apiKey.isEmpty {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }

        // Encode body if provided
        if let body {
            request.httpBody = try encoder.encode(body)
        }

        // Log request
        APILogger.shared.logRequest(
            method: method.rawValue,
            url: url,
            headers: request.allHTTPHeaderFields,
            body: request.httpBody
        )

        let startTime = Date()

        // Execute with retry logic
        let executor = retryPolicy.map { RetryExecutor(policy: $0) } ?? retryExecutor

        // Capture immutable request for closure
        let capturedRequest = request
        let capturedUrl = url

        return try await executor.execute { [self] in
            try await self.executeAndParse(capturedRequest, url: capturedUrl, startTime: startTime) as T
        }
    }

    /// Execute a request and parse response (for retry logic)
    private func executeAndParse<T: Decodable>(_ request: URLRequest, url: URL, startTime: Date) async throws -> T {
        let (data, response) = try await performRequest(request)

        let duration = Date().timeIntervalSince(startTime)

        // Log response
        if let httpResponse = response as? HTTPURLResponse {
            APILogger.shared.logResponse(
                url: url,
                statusCode: httpResponse.statusCode,
                headers: httpResponse.allHeaderFields,
                body: data,
                duration: duration
            )
        }

        return try handleResponse(data: data, response: response)
    }

    /// Perform a request expecting an ApiResponse envelope
    public func requestWithEnvelope<T: Decodable>(
        _ method: HTTPMethod,
        path: String,
        queryItems: [URLQueryItem]? = nil,
        body: (any Encodable)? = nil,
        timeout: TimeInterval? = nil
    ) async throws -> T {
        let envelope: ApiResponse<T> = try await request(
            method,
            path: path,
            queryItems: queryItems,
            body: body,
            timeout: timeout
        )

        if envelope.success, let data = envelope.data {
            return data
        } else if let error = envelope.error {
            throw APIClientError.serverError(error)
        } else {
            throw APIClientError.decodingError("Response success=true but no data")
        }
    }

    /// Perform a request that returns raw Data (for audio files)
    public func requestData(
        _ method: HTTPMethod,
        path: String,
        queryItems: [URLQueryItem]? = nil,
        body: Data? = nil,
        contentType: String? = nil,
        timeout: TimeInterval? = nil
    ) async throws -> (data: Data, response: HTTPURLResponse) {
        let url = try buildURL(path: path, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.timeoutInterval = timeout ?? configuration.defaultTimeout

        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        // Add API key header if configured
        if let apiKey = configuration.apiKey, !apiKey.isEmpty {
            request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        }

        if let body {
            request.httpBody = body
        }

        APILogger.shared.logRequest(
            method: method.rawValue,
            url: url,
            headers: request.allHTTPHeaderFields,
            body: body
        )

        let startTime = Date()
        let (data, response) = try await performRequest(request)
        let duration = Date().timeIntervalSince(startTime)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidRequest("Invalid response type")
        }

        APILogger.shared.logResponse(
            url: url,
            statusCode: httpResponse.statusCode,
            headers: httpResponse.allHeaderFields,
            body: nil, // Don't log binary data
            duration: duration
        )

        // Check for unauthorized
        if httpResponse.statusCode == 401 {
            throw APIClientError.unauthorized
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIClientError.httpError(
                statusCode: httpResponse.statusCode,
                message: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            )
        }

        return (data, httpResponse)
    }

    // MARK: - Private Helpers

    private func buildURL(path: String, queryItems: [URLQueryItem]?) throws -> URL {
        var components = URLComponents(url: configuration.baseURL, resolvingAgainstBaseURL: true)!

        // Append path
        let basePath = components.path
        components.path = basePath + (path.hasPrefix("/") ? path : "/\(path)")

        // Add query items
        if let queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }

        guard let url = components.url else {
            throw APIClientError.invalidRequest("Failed to construct URL for path: \(path)")
        }

        return url
    }

    private func performRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            switch error.code {
            case .timedOut:
                throw APIClientError.timeout
            case .cancelled:
                throw APIClientError.cancelled
            case .notConnectedToInternet, .networkConnectionLost:
                throw APIClientError.networkError("No network connection")
            default:
                throw APIClientError.networkError(error.localizedDescription)
            }
        } catch {
            throw APIClientError.networkError(error.localizedDescription)
        }
    }

    private func handleResponse<T: Decodable>(data: Data, response: URLResponse) throws -> T {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidRequest("Invalid response type")
        }

        // Check for unauthorized
        if httpResponse.statusCode == 401 {
            throw APIClientError.unauthorized
        }

        // Check for rate limiting
        if httpResponse.statusCode == 429 {
            let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
                .flatMap { Double($0) }
            throw APIClientError.rateLimited(retryAfter: retryAfter)
        }

        // Check for HTTP errors
        guard (200...299).contains(httpResponse.statusCode) else {
            // Try to parse error response
            if let envelope = try? decoder.decode(ApiResponse<EmptyResponse>.self, from: data),
               let error = envelope.error {
                throw APIClientError.serverError(error)
            }

            throw APIClientError.httpError(
                statusCode: httpResponse.statusCode,
                message: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            )
        }

        // Decode response
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            APILogger.shared.logError(error, context: "Decoding \(T.self)")
            throw APIClientError.decodingError(error.localizedDescription)
        }
    }
}

/// Empty response type for endpoints that don't return data
public struct EmptyResponse: Codable, Equatable {
    public init() {}
}

/// Simple success response
public struct SuccessResponse: Codable, Equatable {
    public let sent: Bool?
    public let read: Bool?
    public let deleted: Bool?
    public let requested: Bool?

    public init(sent: Bool? = nil, read: Bool? = nil, deleted: Bool? = nil, requested: Bool? = nil) {
        self.sent = sent
        self.read = read
        self.deleted = deleted
        self.requested = requested
    }
}

/// Identity response for mail identity endpoint
public struct IdentityResponse: Codable, Equatable {
    public let identity: String

    public init(identity: String) {
        self.identity = identity
    }
}

/// Spawn polecat response
public struct SpawnPolecatResponse: Codable, Equatable {
    public let rig: String
    public let requested: Bool

    public init(rig: String, requested: Bool) {
        self.rig = rig
        self.requested = requested
    }
}

/// Request body for updating a bead's status
public struct BeadStatusUpdateRequest: Codable, Equatable {
    public let status: String

    public init(status: String) {
        self.status = status
    }
}

/// Response from updating a bead's status
public struct BeadUpdateResponse: Codable, Equatable {
    public let id: String
    public let status: String

    public init(id: String, status: String) {
        self.id = id
        self.status = status
    }
}
