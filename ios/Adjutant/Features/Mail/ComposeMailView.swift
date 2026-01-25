import SwiftUI
import AdjutantKit

/// Mail compose view for creating new messages or replies.
struct ComposeMailView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: ComposeMailViewModel

    init(replyToId: String? = nil) {
        _viewModel = StateObject(wrappedValue: ComposeMailViewModel(replyToId: replyToId))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                    // Reply context (if replying)
                    if let originalMessage = viewModel.originalMessage {
                        replyContextCard(originalMessage)
                    }

                    // Recipient field
                    recipientSection

                    // Subject field
                    subjectSection

                    // Body field
                    bodySection

                    // Priority selector
                    prioritySection

                    // Send button
                    sendButton
                }
                .padding(CRTTheme.Spacing.md)
            }
            .background(CRTTheme.Background.screen)
            #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText(viewModel.isReply ? "REPLY" : "COMPOSE", style: .subheader, glowIntensity: .subtle)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .foregroundColor(theme.primary)
                }
            }
            .onAppear {
                viewModel.onAppear()
            }
            .onDisappear {
                viewModel.onDisappear()
                viewModel.stopDictation()
            }
            .onChange(of: viewModel.sendSuccess) { _, success in
                if success {
                    dismiss()
                }
            }
        }
    }

    // MARK: - Reply Context

    @ViewBuilder
    private func replyContextCard(_ message: Message) -> some View {
        CRTCard(header: "REPLYING TO") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                HStack {
                    CRTText("FROM:", style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                    CRTText(message.senderName, style: .body, glowIntensity: .subtle)
                }

                CRTText(message.subject, style: .body, glowIntensity: .none)
                    .foregroundColor(theme.dim)

                CRTText(message.body.prefix(150) + (message.body.count > 150 ? "..." : ""),
                        style: .caption,
                        glowIntensity: .none)
                    .foregroundColor(theme.dim.opacity(0.7))
            }
        }
        .crtCardStyle(.minimal)
    }

    // MARK: - Recipient Section

    @ViewBuilder
    private var recipientSection: some View {
        CRTCard(header: "RECIPIENT") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                CRTTextField(
                    "Enter recipient...",
                    text: $viewModel.recipient,
                    icon: "person"
                )
                .disabled(viewModel.isReply)
                .onTapGesture {
                    if !viewModel.isReply {
                        viewModel.showRecipientAutocomplete = true
                    }
                }

                // Autocomplete dropdown
                if viewModel.showRecipientAutocomplete && !viewModel.filteredRecipients.isEmpty {
                    recipientAutocomplete
                }
            }
        }
    }

    @ViewBuilder
    private var recipientAutocomplete: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(viewModel.filteredRecipients.prefix(5)) { crew in
                Button {
                    viewModel.selectRecipient(crew)
                } label: {
                    HStack {
                        Image(systemName: iconForAgentType(crew.type))
                            .foregroundColor(theme.dim)

                        VStack(alignment: .leading, spacing: 2) {
                            CRTText(crew.name, style: .body, glowIntensity: .subtle)
                            CRTText(crew.id, style: .caption, glowIntensity: .none)
                                .foregroundColor(theme.dim)
                        }

                        Spacer()

                        statusBadge(crew.status)
                    }
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                }
                .buttonStyle(.plain)

                if crew.id != viewModel.filteredRecipients.prefix(5).last?.id {
                    Divider()
                        .background(theme.dim.opacity(0.3))
                }
            }
        }
        .background(CRTTheme.Background.elevated.opacity(0.8))
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.dim.opacity(0.5), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
    }

    // MARK: - Subject Section

    @ViewBuilder
    private var subjectSection: some View {
        CRTCard(header: "SUBJECT") {
            HStack(spacing: CRTTheme.Spacing.xs) {
                CRTTextField("Enter subject...", text: $viewModel.subject)

                if viewModel.voiceAvailable {
                    voiceButton(for: .subject)
                }
            }
        }
    }

    // MARK: - Body Section

    @ViewBuilder
    private var bodySection: some View {
        CRTCard(header: "MESSAGE") {
            VStack(alignment: .trailing, spacing: CRTTheme.Spacing.xs) {
                CRTTextEditor(
                    "Enter your message...",
                    text: $viewModel.body,
                    showCharacterCount: true,
                    maxLength: 5000,
                    minHeight: 150
                )

                if viewModel.voiceAvailable {
                    voiceButton(for: .body)
                }
            }
        }
        .crtCardStyle(.elevated)
    }

    // MARK: - Priority Section

    @ViewBuilder
    private var prioritySection: some View {
        CRTCard(header: "PRIORITY") {
            HStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(MessagePriority.allCases, id: \.rawValue) { priority in
                    priorityButton(priority)
                }
            }
        }
    }

    @ViewBuilder
    private func priorityButton(_ priority: MessagePriority) -> some View {
        let isSelected = viewModel.priority == priority

        Button {
            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                viewModel.priority = priority
            }
        } label: {
            VStack(spacing: CRTTheme.Spacing.xxs) {
                CRTText(priorityLabel(priority), style: .caption, glowIntensity: isSelected ? .medium : .none)
                    .foregroundColor(isSelected ? priorityColor(priority) : theme.dim)
            }
            .padding(.vertical, CRTTheme.Spacing.xs)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(isSelected ? priorityColor(priority).opacity(0.2) : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(isSelected ? priorityColor(priority) : theme.dim.opacity(0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Voice Button

    @ViewBuilder
    private func voiceButton(for target: ComposeMailViewModel.DictationTarget) -> some View {
        let isRecordingThis = viewModel.isRecording && viewModel.dictationTarget == target

        Button {
            if isRecordingThis {
                viewModel.stopDictation()
            } else {
                viewModel.startDictation(for: target)
            }
        } label: {
            Image(systemName: isRecordingThis ? "mic.fill" : "mic")
                .font(.system(size: 20))
                .foregroundColor(isRecordingThis ? CRTTheme.State.error : theme.primary)
                .frame(width: 44, height: 44)
                .background(
                    Circle()
                        .fill(isRecordingThis ? CRTTheme.State.error.opacity(0.2) : theme.primary.opacity(0.1))
                )
                .overlay(
                    Circle()
                        .stroke(isRecordingThis ? CRTTheme.State.error : theme.primary.opacity(0.5), lineWidth: 1)
                )
        }
        .accessibilityLabel(isRecordingThis ? "Stop recording" : "Start voice input")
    }

    // MARK: - Send Button

    @ViewBuilder
    private var sendButton: some View {
        HStack {
            Spacer()

            CRTButton(
                "SEND",
                variant: .primary,
                size: .large,
                isLoading: viewModel.isLoading
            ) {
                Task {
                    await viewModel.sendMessage()
                }
            }
            .disabled(!viewModel.canSend)

            Spacer()
        }
        .padding(.top, CRTTheme.Spacing.md)
    }

    // MARK: - Error Banner

    @ViewBuilder
    private var errorBanner: some View {
        if let error = viewModel.errorMessage {
            ErrorBanner(message: error) {
                viewModel.clearError()
            }
        }
    }

    // MARK: - Helpers

    private func iconForAgentType(_ type: AgentType) -> String {
        switch type {
        case .mayor: return "crown"
        case .deacon: return "bell"
        case .witness: return "eye"
        case .refinery: return "gearshape.2"
        case .crew: return "person"
        case .polecat: return "bolt"
        }
    }

    @ViewBuilder
    private func statusBadge(_ status: CrewMemberStatus) -> some View {
        let color: Color = {
            switch status {
            case .idle: return theme.dim
            case .working: return CRTTheme.State.success
            case .blocked: return CRTTheme.State.warning
            case .stuck: return CRTTheme.State.error
            case .offline: return CRTTheme.State.offline
            }
        }()

        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }

    private func priorityLabel(_ priority: MessagePriority) -> String {
        switch priority {
        case .urgent: return "P0"
        case .high: return "P1"
        case .normal: return "P2"
        case .low: return "P3"
        case .lowest: return "P4"
        }
    }

    private func priorityColor(_ priority: MessagePriority) -> Color {
        switch priority {
        case .urgent: return CRTTheme.Priority.urgent
        case .high: return CRTTheme.Priority.high
        case .normal: return theme.primary
        case .low: return theme.dim
        case .lowest: return CRTTheme.Priority.lowest
        }
    }
}

// MARK: - Preview

#Preview("New Message") {
    ComposeMailView()
}

#Preview("Reply") {
    ComposeMailView(replyToId: "test-123")
}
