import SwiftUI

// MARK: - Communication Method

/// The communication method currently in use between the app and backend.
enum CommunicationMethod: String {
    case http = "HTTP"
    case sse = "SSE"
    case websocket = "WS"

    var icon: String {
        switch self {
        case .http: return "arrow.up.arrow.down"
        case .sse: return "antenna.radiowaves.left.and.right"
        case .websocket: return "bolt.horizontal"
        }
    }

    var displayName: String {
        rawValue
    }

    var description: String {
        switch self {
        case .http: return "HTTP Polling"
        case .sse: return "Server-Sent Events"
        case .websocket: return "WebSocket"
        }
    }
}

// MARK: - Connection State

/// The state of the connection to the backend.
enum ConnectionState: Equatable {
    case connected
    case connecting
    case streaming
    case disconnected

    var label: String {
        switch self {
        case .connected: return "CONNECTED"
        case .connecting: return "CONNECTING"
        case .streaming: return "STREAMING"
        case .disconnected: return "DEGRADED"
        }
    }

    var statusType: BadgeView.Style.StatusType {
        switch self {
        case .connected: return .success
        case .connecting: return .warning
        case .streaming: return .info
        case .disconnected: return .offline
        }
    }

    var color: Color {
        statusType.color
    }
}

// MARK: - ConnectionStatusBadge

/// A compact badge showing the current communication method and connection state.
///
/// Displays the communication protocol (HTTP/SSE/WS) and connection state
/// with CRT-styled visuals. Tapping reveals a popover with detailed
/// connection information.
///
/// ## Example Usage
/// ```swift
/// ConnectionStatusBadge(
///     method: .http,
///     state: .connected,
///     isStreaming: false
/// )
/// ```
struct ConnectionStatusBadge: View {
    @Environment(\.crtTheme) private var theme

    let method: CommunicationMethod
    let state: ConnectionState
    let isStreaming: Bool
    var onTap: (() -> Void)?

    @State private var streamPulse = false

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                // Status dot
                StatusDot(state.statusType, size: 6, pulse: isStreaming)

                // Method label
                Text(method.displayName)
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .tracking(CRTTheme.Typography.letterSpacing)
                    .foregroundColor(state.color)

                // Streaming indicator
                if isStreaming {
                    streamingIndicator
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.xs)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(state.color.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(state.color.opacity(0.3), lineWidth: 1)
            )
            .crtGlow(
                color: state.color,
                radius: isStreaming ? 4 : 0,
                intensity: isStreaming ? 0.3 : 0
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(method.description), \(state.label)\(isStreaming ? ", streaming" : "")")
        .accessibilityHint(onTap != nil ? "Tap for connection details" : "")
    }

    private var streamingIndicator: some View {
        HStack(spacing: 2) {
            ForEach(0..<3) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(CRTTheme.State.info)
                    .frame(width: 2, height: streamPulse ? 8 : 4)
                    .animation(
                        .easeInOut(duration: 0.4)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.15),
                        value: streamPulse
                    )
            }
        }
        .frame(height: 8)
        .onAppear { streamPulse = true }
        .onDisappear { streamPulse = false }
    }
}

// MARK: - ConnectionDetailsSheet

/// A sheet showing detailed connection information.
struct ConnectionDetailsSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let method: CommunicationMethod
    let state: ConnectionState
    let isStreaming: Bool
    let networkType: NetworkMonitor.ConnectionType
    let serverURL: String
    let lastPollTime: Date?
    let pollingInterval: TimeInterval

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: CRTTheme.Spacing.md) {
                        // Connection overview
                        connectionOverview

                        // Method details
                        methodDetails

                        // Network info
                        networkInfo
                    }
                    .padding(CRTTheme.Spacing.md)
                }
            }
            .background(theme.background.screen)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("CONNECTION DETAILS", style: .subheader, glowIntensity: .subtle)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .foregroundColor(theme.primary)
                }
            }
        }
    }

    private var connectionOverview: some View {
        CRTCard {
            VStack(spacing: CRTTheme.Spacing.sm) {
                HStack {
                    Image(systemName: method.icon)
                        .font(.system(size: 24))
                        .foregroundColor(state.color)
                    VStack(alignment: .leading, spacing: 2) {
                        CRTText(method.description.uppercased(), style: .subheader, glowIntensity: .medium)
                        CRTText(state.label, style: .caption, glowIntensity: .subtle, color: state.color)
                    }
                    Spacer()
                    StatusDot(state.statusType, size: 12, pulse: isStreaming)
                }

                if isStreaming {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        Image(systemName: "waveform")
                            .font(.system(size: 12))
                            .foregroundColor(CRTTheme.State.info)
                        CRTText("ACTIVE STREAM", style: .caption, glowIntensity: .subtle, color: CRTTheme.State.info)
                        Spacer()
                    }
                }
            }
        }
    }

    private var methodDetails: some View {
        CRTCard {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                CRTText("PROTOCOL", style: .caption, glowIntensity: .subtle, color: theme.dim)

                detailRow(label: "METHOD", value: method.rawValue)
                detailRow(label: "SERVER", value: serverURL)

                if method == .http {
                    detailRow(label: "POLL INTERVAL", value: "\(Int(pollingInterval))s")
                    if let lastPoll = lastPollTime {
                        detailRow(label: "LAST POLL", value: formatTimestamp(lastPoll))
                    }
                }
            }
        }
    }

    private var networkInfo: some View {
        CRTCard {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                CRTText("NETWORK", style: .caption, glowIntensity: .subtle, color: theme.dim)

                detailRow(label: "TYPE", value: networkType.rawValue.uppercased())
                detailRow(label: "STATUS", value: state == .disconnected ? "UNAVAILABLE" : "AVAILABLE")
            }
        }
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack {
            CRTText(label, style: .caption, glowIntensity: .none, color: theme.dim)
            Spacer()
            CRTText(value, style: .caption, glowIntensity: .subtle)
        }
    }

    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }
}

// MARK: - Preview

#Preview("ConnectionStatusBadge - HTTP Connected") {
    HStack(spacing: 12) {
        ConnectionStatusBadge(method: .http, state: .connected, isStreaming: false)
        ConnectionStatusBadge(method: .sse, state: .connected, isStreaming: false)
        ConnectionStatusBadge(method: .websocket, state: .connected, isStreaming: true)
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
    .preferredColorScheme(.dark)
}

#Preview("ConnectionStatusBadge - States") {
    VStack(spacing: 12) {
        ConnectionStatusBadge(method: .http, state: .connected, isStreaming: false)
        ConnectionStatusBadge(method: .http, state: .connecting, isStreaming: false)
        ConnectionStatusBadge(method: .websocket, state: .streaming, isStreaming: true)
        ConnectionStatusBadge(method: .http, state: .disconnected, isStreaming: false)
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
    .preferredColorScheme(.dark)
}
