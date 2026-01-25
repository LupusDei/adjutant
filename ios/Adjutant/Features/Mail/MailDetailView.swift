import SwiftUI
import AdjutantKit

/// Mail message detail view displaying full message content with thread history.
struct MailDetailView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel: MailDetailViewModel

    init(messageId: String) {
        _viewModel = StateObject(wrappedValue: MailDetailViewModel(messageId: messageId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                if viewModel.isLoading {
                    LoadingIndicator()
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let message = viewModel.message {
                    // Message header
                    messageHeader(message)

                    // Thread history (if any)
                    if viewModel.hasThread {
                        threadSection
                    }

                    // Message body
                    messageBody(message)

                    // Action buttons
                    actionButtons(message)
                } else if let error = viewModel.errorMessage {
                    errorView(error)
                }
            }
            .padding(CRTTheme.Spacing.md)
        }
        .background(CRTTheme.Background.screen)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                CRTText("MESSAGE", style: .subheader, glowIntensity: .subtle)
            }
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
            viewModel.stopAudio()
        }
    }

    // MARK: - Message Header

    @ViewBuilder
    private func messageHeader(_ message: Message) -> some View {
        CRTCard(header: "HEADER") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Subject
                CRTText(message.subject, style: .subheader, glowIntensity: .medium)

                Divider()
                    .background(theme.dim.opacity(0.5))

                // From
                HStack {
                    CRTText("FROM:", style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                    CRTText(message.senderName, style: .body, glowIntensity: .subtle)
                }

                // To
                HStack {
                    CRTText("TO:", style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                    CRTText(message.to, style: .body, glowIntensity: .subtle)
                }

                // Date
                HStack {
                    CRTText("DATE:", style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                    CRTText(viewModel.formattedDate, style: .body, glowIntensity: .subtle)
                }

                // Priority & Type
                HStack(spacing: CRTTheme.Spacing.md) {
                    priorityBadge(message.priority)
                    typeBadge(message.type)
                }
            }
        }
    }

    // MARK: - Thread Section

    @ViewBuilder
    private var threadSection: some View {
        CRTCard(header: "THREAD", headerBadge: "\(viewModel.threadMessages.count) MESSAGES") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                ForEach(viewModel.threadMessages) { threadMessage in
                    threadMessageRow(threadMessage)

                    if threadMessage.id != viewModel.threadMessages.last?.id {
                        Divider()
                            .background(theme.dim.opacity(0.3))
                    }
                }
            }
        }
        .crtCardStyle(.minimal)
    }

    @ViewBuilder
    private func threadMessageRow(_ message: Message) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            HStack {
                CRTText(message.senderName, style: .caption, glowIntensity: .subtle)
                Spacer()
                CRTText(formatThreadDate(message.date), style: .caption, glowIntensity: .none)
                    .foregroundColor(theme.dim)
            }

            CRTText(message.body.prefix(100) + (message.body.count > 100 ? "..." : ""),
                    style: .body,
                    glowIntensity: .none)
                .foregroundColor(theme.dim)
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }

    // MARK: - Message Body

    @ViewBuilder
    private func messageBody(_ message: Message) -> some View {
        CRTCard(header: "MESSAGE") {
            CRTText(message.body, style: .mono, glowIntensity: .subtle)
                .fixedSize(horizontal: false, vertical: true)
        }
        .crtCardStyle(.elevated)
    }

    // MARK: - Action Buttons

    @ViewBuilder
    private func actionButtons(_ message: Message) -> some View {
        HStack(spacing: CRTTheme.Spacing.md) {
            // Reply button
            CRTButton("REPLY", variant: .primary) {
                coordinator.presentSheet(.mailCompose(replyTo: message.id))
            }

            // Audio button
            if viewModel.isPlayingAudio {
                CRTButton("STOP", variant: .danger) {
                    viewModel.stopAudio()
                }
            } else {
                CRTButton("PLAY", variant: .secondary, isLoading: viewModel.isSynthesizing) {
                    Task {
                        await viewModel.playAudio()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Helper Views

    @ViewBuilder
    private func priorityBadge(_ priority: MessagePriority) -> some View {
        BadgeView(priorityText(priority), style: .priority(priority.rawValue))
    }

    @ViewBuilder
    private func typeBadge(_ type: MessageType) -> some View {
        BadgeView(type.rawValue.uppercased(), style: .tag)
    }

    @ViewBuilder
    private func errorView(_ error: String) -> some View {
        CRTCard {
            VStack(spacing: CRTTheme.Spacing.md) {
                CRTText("ERROR", style: .subheader, color: CRTTheme.State.error)
                CRTText(error, style: .body, glowIntensity: .subtle)
                    .foregroundColor(theme.dim)

                CRTButton("RETRY", variant: .secondary) {
                    Task {
                        await viewModel.loadMessage()
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    private func priorityText(_ priority: MessagePriority) -> String {
        switch priority {
        case .urgent: return "P0 URGENT"
        case .high: return "P1 HIGH"
        case .normal: return "P2"
        case .low: return "P3"
        case .lowest: return "P4"
        }
    }

    private func formatThreadDate(_ date: Date?) -> String {
        guard let date = date else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        MailDetailView(messageId: "test-123")
    }
    .environmentObject(AppCoordinator())
}
