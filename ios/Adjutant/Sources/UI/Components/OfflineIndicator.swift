import SwiftUI

// MARK: - OfflineIndicator

/// A banner that displays when the device is offline.
///
/// Shows a full-width banner with warning styling to indicate
/// network connectivity issues. Appears at the top of the screen
/// below the header.
///
/// ## Example Usage
/// ```swift
/// VStack {
///     OfflineIndicator()
///     // ... other content
/// }
/// ```
public struct OfflineIndicator: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var networkMonitor = NetworkMonitor.shared
    @ObservedObject private var appState = AppState.shared

    @State private var isPulsing = false

    public init() {}

    public var body: some View {
        Group {
            if !appState.isNetworkAvailable {
                banner
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: appState.isNetworkAvailable)
    }

    private var banner: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Offline icon with pulse animation
            Image(systemName: "wifi.slash")
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(CRTTheme.State.warning)
                .shadow(color: CRTTheme.State.warning.opacity(isPulsing ? 0.8 : 0.4), radius: isPulsing ? 8 : 4)
                .onAppear {
                    withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                        isPulsing = true
                    }
                }

            VStack(alignment: .leading, spacing: 2) {
                Text("OFFLINE")
                    .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                    .tracking(CRTTheme.Typography.letterSpacing)
                    .foregroundColor(CRTTheme.State.warning)

                if let message = networkMonitor.statusMessage {
                    Text(message.uppercased())
                        .font(CRTTheme.Typography.font(size: 10))
                        .foregroundColor(CRTTheme.State.warning.opacity(0.8))
                }
            }

            Spacer()

            // Connection type indicator
            Text(networkMonitor.connectionType.rawValue.uppercased())
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .foregroundColor(CRTTheme.State.warning.opacity(0.7))
                .padding(.horizontal, CRTTheme.Spacing.xs)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(CRTTheme.State.warning.opacity(0.1))
                )
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.State.warning.opacity(0.1))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(CRTTheme.State.warning.opacity(0.4)),
            alignment: .bottom
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Offline. No network connection available.")
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Compact Offline Indicator

/// A smaller offline indicator for use in headers or toolbars.
public struct CompactOfflineIndicator: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    public init() {}

    public var body: some View {
        Group {
            if !appState.isNetworkAvailable {
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Image(systemName: "wifi.slash")
                        .font(.system(size: 12, weight: .medium))

                    Text("OFFLINE")
                        .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                        .tracking(CRTTheme.Typography.letterSpacing)
                }
                .foregroundColor(CRTTheme.State.warning)
                .padding(.horizontal, CRTTheme.Spacing.xs)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(CRTTheme.State.warning.opacity(0.15))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(CRTTheme.State.warning.opacity(0.3), lineWidth: 1)
                )
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: appState.isNetworkAvailable)
        .accessibilityLabel(appState.isNetworkAvailable ? "" : "Offline")
    }
}

// MARK: - View Modifier for Offline Overlay

/// A view modifier that adds an offline indicator overlay.
public struct OfflineOverlayModifier: ViewModifier {
    @ObservedObject private var appState = AppState.shared

    let position: VerticalAlignment

    public init(position: VerticalAlignment = .top) {
        self.position = position
    }

    public func body(content: Content) -> some View {
        ZStack(alignment: position == .top ? .top : .bottom) {
            content

            if !appState.isNetworkAvailable {
                OfflineIndicator()
            }
        }
    }
}

extension View {
    /// Adds an offline indicator overlay to the view.
    /// - Parameter position: Where to show the indicator (`.top` or `.bottom`)
    public func offlineOverlay(position: VerticalAlignment = .top) -> some View {
        modifier(OfflineOverlayModifier(position: position))
    }
}

// MARK: - Preview

#Preview("OfflineIndicator") {
    VStack {
        OfflineIndicator()
        Spacer()
    }
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
    .onAppear {
        // Simulate offline state for preview
        AppState.shared.updateNetworkAvailability(false)
    }
}

#Preview("CompactOfflineIndicator") {
    HStack {
        Text("HEADER")
            .foregroundColor(.white)
        Spacer()
        CompactOfflineIndicator()
    }
    .padding()
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
    .onAppear {
        AppState.shared.updateNetworkAvailability(false)
    }
}

#Preview("OfflineOverlay") {
    VStack {
        Text("Content")
            .foregroundColor(.white)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(CRTTheme.Background.screen)
    .offlineOverlay()
    .preferredColorScheme(.dark)
    .onAppear {
        AppState.shared.updateNetworkAvailability(false)
    }
}
