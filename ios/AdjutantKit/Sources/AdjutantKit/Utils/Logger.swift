import Foundation
import os.log

/// Log levels for API logging
public enum APILogLevel: Int, Comparable, Sendable {
    case debug = 0
    case info = 1
    case warning = 2
    case error = 3

    public static func < (lhs: APILogLevel, rhs: APILogLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var osLogType: OSLogType {
        switch self {
        case .debug: return .debug
        case .info: return .info
        case .warning: return .default
        case .error: return .error
        }
    }

    var prefix: String {
        switch self {
        case .debug: return "[DEBUG]"
        case .info: return "[INFO]"
        case .warning: return "[WARN]"
        case .error: return "[ERROR]"
        }
    }
}

/// Logger for API requests and responses
public final class APILogger: @unchecked Sendable {
    public static let shared = APILogger()

    private let osLog: OSLog
    private var minimumLevel: APILogLevel = .debug
    private var isEnabled: Bool

    private init() {
        self.osLog = OSLog(subsystem: "com.adjutant.kit", category: "API")
        #if DEBUG
        self.isEnabled = true
        #else
        self.isEnabled = false
        #endif
    }

    /// Configure the logger
    public func configure(minimumLevel: APILogLevel = .debug, enabled: Bool? = nil) {
        self.minimumLevel = minimumLevel
        if let enabled {
            self.isEnabled = enabled
        }
    }

    /// Log a message at the specified level
    public func log(_ level: APILogLevel, _ message: @autoclosure () -> String) {
        guard isEnabled, level >= minimumLevel else { return }

        let msg = message()
        os_log("%{public}@ %{public}@", log: osLog, type: level.osLogType, level.prefix, msg)
    }

    /// Log a request
    public func logRequest(
        method: String,
        url: URL,
        headers: [String: String]? = nil,
        body: Data? = nil
    ) {
        guard isEnabled else { return }

        var message = "→ \(method) \(url.absoluteString)"

        if let headers, !headers.isEmpty {
            let headerStr = headers.map { "\($0.key): \($0.value)" }.joined(separator: ", ")
            message += "\n  Headers: [\(headerStr)]"
        }

        if let body, !body.isEmpty {
            if let bodyStr = String(data: body, encoding: .utf8) {
                let truncated = bodyStr.count > 500 ? String(bodyStr.prefix(500)) + "..." : bodyStr
                message += "\n  Body: \(truncated)"
            } else {
                message += "\n  Body: \(body.count) bytes"
            }
        }

        log(.debug, message)
    }

    /// Log a response
    public func logResponse(
        url: URL,
        statusCode: Int,
        headers: [AnyHashable: Any]? = nil,
        body: Data? = nil,
        duration: TimeInterval
    ) {
        guard isEnabled else { return }

        let level: APILogLevel = statusCode >= 400 ? .warning : .debug
        var message = "← \(statusCode) \(url.absoluteString) (\(String(format: "%.2f", duration * 1000))ms)"

        if let body, !body.isEmpty {
            if let bodyStr = String(data: body, encoding: .utf8) {
                let truncated = bodyStr.count > 1000 ? String(bodyStr.prefix(1000)) + "..." : bodyStr
                message += "\n  Body: \(truncated)"
            } else {
                message += "\n  Body: \(body.count) bytes"
            }
        }

        log(level, message)
    }

    /// Log an error
    public func logError(_ error: Error, context: String? = nil) {
        guard isEnabled else { return }

        var message = "✖ Error"
        if let context {
            message += " (\(context))"
        }
        message += ": \(error.localizedDescription)"

        log(.error, message)
    }
}
