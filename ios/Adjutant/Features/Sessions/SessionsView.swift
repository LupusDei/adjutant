import SwiftUI
import AdjutantKit

/// Agent switcher view showing all active sessions with status.
/// Presented as a bottom sheet from the chat or dashboard view.
/// Tap to switch active session. Start/stop agent buttons.
struct SessionsView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: SessionsViewModel

    /// Callback when user switches to a session
    var onSessionSelected: ((ManagedSession) -> Void)?

    init(apiClient: APIClient? = nil, onSessionSelected: ((ManagedSession) -> Void)? = nil) {
        _viewModel = StateObject(wrappedValue: SessionsViewModel(apiClient: apiClient))
        self.onSessionSelected = onSessionSelected
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerView

            // Content
            contentView
        }
        .background(CRTTheme.Background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("SESSIONS", style: .subheader, glowIntensity: .medium)
                CRTText(
                    "\(viewModel.liveSessionCount) ACTIVE",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }

            Spacer()

            // Refresh
            Button {
                Task { await viewModel.refresh() }
            } label: {
                if viewModel.isLoading {
                    LoadingIndicator(size: .small)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(theme.primary)
                }
            }
            .disabled(viewModel.isLoading)

            // Close
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(theme.dim)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            CRTTheme.Background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .bottom
                )
        )
    }

    // MARK: - Content

    @ViewBuilder
    private var contentView: some View {
        if viewModel.isLoading && viewModel.sessions.isEmpty {
            loadingView
        } else if viewModel.sessions.isEmpty {
            emptyView
        } else {
            sessionsList
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("SCANNING SESSIONS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO ACTIVE SESSIONS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText(
                "Sessions will appear here when agents are running.",
                style: .body,
                glowIntensity: .none,
                color: theme.dim.opacity(0.6)
            )
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var sessionsList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(viewModel.sessions) { session in
                    SessionRowView(
                        session: session,
                        isActive: session.id == viewModel.activeSessionId,
                        onTap: {
                            viewModel.switchTo(sessionId: session.id)
                            onSessionSelected?(session)
                            dismiss()
                        },
                        onKill: {
                            Task { await viewModel.killSession(id: session.id) }
                        }
                    )
                }

                // Error banner
                if let error = viewModel.errorMessage {
                    ErrorBanner(
                        message: error,
                        onRetry: {
                            Task { await viewModel.refresh() }
                        },
                        onDismiss: { viewModel.clearError() }
                    )
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .refreshable {
            await viewModel.refresh()
        }
    }
}

// MARK: - Session Switcher Button

/// Compact button that shows the active session and opens the switcher sheet.
struct SessionSwitcherButton: View {
    @Environment(\.crtTheme) private var theme
    @State private var showingSessions = false

    /// Optional callback when a session is selected
    var onSessionSelected: ((ManagedSession) -> Void)?

    var body: some View {
        Button {
            showingSessions = true
        } label: {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Image(systemName: "terminal")
                    .font(.system(size: 12, weight: .medium))
                CRTText("SESSIONS", style: .caption, glowIntensity: .subtle)
            }
            .foregroundColor(theme.primary)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xxs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(theme.primary.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.primary.opacity(0.3), lineWidth: 1)
            )
        }
        .sheet(isPresented: $showingSessions) {
            SessionsView(onSessionSelected: onSessionSelected)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Preview

#Preview("Sessions View") {
    SessionsView()
}

#Preview("Session Switcher Button") {
    VStack {
        Spacer()
        HStack {
            SessionSwitcherButton()
            Spacer()
        }
        .padding()
    }
    .background(CRTTheme.Background.screen)
}
