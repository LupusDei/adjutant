import Foundation
import Network
import Combine

/// Monitors network connectivity and publishes changes to AppState.
///
/// Uses Apple's Network framework (NWPathMonitor) to track connectivity status
/// and automatically updates AppState.shared.isNetworkAvailable.
@MainActor
public final class NetworkMonitor: ObservableObject {
    // MARK: - Singleton

    public static let shared = NetworkMonitor()

    // MARK: - Published Properties

    /// Whether network is currently available
    @Published public private(set) var isConnected: Bool = true

    /// The current connection type
    @Published public private(set) var connectionType: ConnectionType = .unknown

    /// Detailed status message for display
    @Published public private(set) var statusMessage: String?

    // MARK: - Connection Type

    public enum ConnectionType: String {
        case wifi = "WiFi"
        case cellular = "Cellular"
        case wiredEthernet = "Ethernet"
        case unknown = "Unknown"
        case none = "None"
    }

    // MARK: - Private Properties

    private let monitor: NWPathMonitor
    private let queue = DispatchQueue(label: "NetworkMonitor")
    private var isMonitoring = false

    // MARK: - Initialization

    private init() {
        self.monitor = NWPathMonitor()
        startMonitoring()
    }

    deinit {
        stopMonitoring()
    }

    // MARK: - Monitoring

    /// Start monitoring network changes
    public func startMonitoring() {
        guard !isMonitoring else { return }

        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.handlePathUpdate(path)
            }
        }

        monitor.start(queue: queue)
        isMonitoring = true
    }

    /// Stop monitoring network changes
    public func stopMonitoring() {
        guard isMonitoring else { return }
        monitor.cancel()
        isMonitoring = false
    }

    // MARK: - Private Methods

    private func handlePathUpdate(_ path: NWPath) {
        let wasConnected = isConnected
        isConnected = path.status == .satisfied

        // Determine connection type
        if path.usesInterfaceType(.wifi) {
            connectionType = .wifi
        } else if path.usesInterfaceType(.cellular) {
            connectionType = .cellular
        } else if path.usesInterfaceType(.wiredEthernet) {
            connectionType = .wiredEthernet
        } else if path.status == .satisfied {
            connectionType = .unknown
        } else {
            connectionType = .none
        }

        // Update status message
        if !isConnected {
            statusMessage = "No network connection"
        } else if path.isExpensive {
            statusMessage = "Using cellular data"
        } else if path.isConstrained {
            statusMessage = "Low data mode enabled"
        } else {
            statusMessage = nil
        }

        // Update AppState
        AppState.shared.updateNetworkAvailability(isConnected)

        // Log transition for debugging
        if wasConnected != isConnected {
            print("[NetworkMonitor] Connection changed: \(isConnected ? "Online" : "Offline") (\(connectionType.rawValue))")
        }
    }
}

// MARK: - Network Error Types

/// Standardized network error for consistent error handling
public enum NetworkError: LocalizedError {
    case noConnection
    case timeout
    case serverUnreachable(String)
    case requestFailed(underlying: Error)

    public var errorDescription: String? {
        switch self {
        case .noConnection:
            return "CONNECTION ERROR: No network available"
        case .timeout:
            return "CONNECTION ERROR: Request timed out"
        case .serverUnreachable(let host):
            return "CONNECTION ERROR: Cannot reach \(host)"
        case .requestFailed(let error):
            return "CONNECTION ERROR: \(error.localizedDescription)"
        }
    }

    public var isRetryable: Bool {
        switch self {
        case .noConnection, .timeout, .serverUnreachable:
            return true
        case .requestFailed:
            return false
        }
    }
}
