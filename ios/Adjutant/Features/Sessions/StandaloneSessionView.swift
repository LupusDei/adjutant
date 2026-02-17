import SwiftUI
import AdjutantKit

/// Standalone session view for Single Agent mode.
/// Automatically finds the first active session and shows SessionChatView for it.
/// Used as the Chat tab content when deployment mode is `.standalone`.
struct StandaloneSessionView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var loader = SessionLoader()

    var body: some View {
        Group {
            if let session = loader.activeSession, let client = loader.wsClient {
                VStack(spacing: 0) {
                    sessionSwitcherBar(current: session)
                    SessionChatView(session: session, wsClient: client)
                        .id(session.id)
                }
            } else if loader.isLoading {
                loadingView
            } else {
                emptyView
            }
        }
        .task {
            await loader.loadIfNeeded()
        }
        .sheet(isPresented: $loader.showingSessionPicker) {
            SessionsView { session in
                loader.switchTo(session)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Session Switcher Bar

    private func sessionSwitcherBar(current: ManagedSession) -> some View {
        Button {
            loader.showingSessionPicker = true
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                StatusDot(.success, size: 6, pulse: current.status == .working)

                CRTText(current.name.uppercased(), style: .caption, glowIntensity: .subtle, color: theme.primary)
                    .lineLimit(1)

                Spacer()

                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Image(systemName: "terminal")
                        .font(.system(size: 11, weight: .medium))
                    CRTText(
                        "SESSIONS (\(loader.sessions.count))",
                        style: .caption,
                        glowIntensity: .subtle
                    )
                    Image(systemName: "chevron.down")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundColor(theme.primary)
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(theme.primary.opacity(0.05))
            .overlay(
                Rectangle()
                    .frame(height: 1)
                    .foregroundColor(theme.primary.opacity(0.2)),
                alignment: .bottom
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - States

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("CONNECTING TO SESSION...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "terminal")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO ACTIVE SESSIONS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText(
                "Start an agent session to begin.",
                style: .body,
                glowIntensity: .none,
                color: theme.dim.opacity(0.6)
            )
            .multilineTextAlignment(.center)

            if let error = loader.errorMessage {
                CRTText(error, style: .caption, glowIntensity: .none, color: .red)
                    .padding(.top, CRTTheme.Spacing.sm)
            }

            Button {
                Task { await loader.refresh() }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14))
                    CRTText("REFRESH", style: .caption, glowIntensity: .subtle)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
            }
            .padding(.top, CRTTheme.Spacing.sm)
        }
        .padding(CRTTheme.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }
}
