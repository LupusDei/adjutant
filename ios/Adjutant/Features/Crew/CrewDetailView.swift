import SwiftUI
import AdjutantKit

/// Detail view for a crew member showing agent info and terminal output (for polecats).
struct CrewDetailView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: CrewDetailViewModel
    @State private var scrollProxy: ScrollViewProxy?

    init(member: CrewMember) {
        _viewModel = StateObject(wrappedValue: CrewDetailViewModel(member: member))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Agent info header
            agentHeader

            // Terminal or status content
            if viewModel.hasTerm {
                terminalView
            } else {
                statusView
            }
        }
        .background(CRTTheme.Background.screen)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        #endif
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                CRTBackButton()
            }

            ToolbarItem(placement: .principal) {
                CRTText(viewModel.member.name.uppercased(), style: .subheader, glowIntensity: .subtle)
            }

            #if os(iOS)
            if viewModel.hasTerm {
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    toolbarButtons
                }
            }
            #else
            if viewModel.hasTerm {
                ToolbarItemGroup(placement: .automatic) {
                    toolbarButtons
                }
            }
            #endif
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .overlay(copyConfirmationOverlay)
    }

    // MARK: - Agent Header

    private var agentHeader: some View {
        CRTCard(header: "AGENT INFO") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Name and type row
                HStack {
                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                        CRTText(viewModel.member.name, style: .subheader, glowIntensity: .medium)
                        CRTText(viewModel.member.type.rawValue.uppercased(), style: .caption, glowIntensity: .subtle, color: theme.dim)
                    }

                    Spacer()

                    // Status badge
                    statusBadge
                }

                Divider()
                    .background(theme.dim.opacity(0.3))

                // Details grid
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    if let rig = viewModel.member.rig {
                        detailRow(label: "RIG", value: rig.uppercased())
                    }

                    if let branch = viewModel.member.branch {
                        detailRow(label: "BRANCH", value: branch)
                    }

                    if let task = viewModel.member.currentTask {
                        detailRow(label: "TASK", value: task)
                    }

                    if (viewModel.member.unreadMail ?? 0) > 0 {
                        detailRow(label: "UNREAD", value: "\(viewModel.member.unreadMail ?? 0) MESSAGES")
                    }
                }
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.top, CRTTheme.Spacing.md)
    }

    private var statusBadge: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            StatusDot(statusType, size: 10, pulse: shouldPulse)
            BadgeView(viewModel.statusDisplayText, style: .status(statusType))
        }
    }

    private var statusType: BadgeView.Style.StatusType {
        switch viewModel.member.status {
        case .idle:
            return .info
        case .working:
            return .success
        case .blocked:
            return .warning
        case .stuck:
            return .error
        case .offline:
            return .offline
        }
    }

    private var shouldPulse: Bool {
        viewModel.member.status == .working || viewModel.member.status == .stuck
    }

    private func detailRow(label: String, value: String) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            CRTText(label + ":", style: .caption, glowIntensity: .subtle, color: theme.dim)
                .frame(width: 70, alignment: .leading)
            CRTText(value, style: .body, glowIntensity: .subtle)
                .lineLimit(2)
        }
    }

    // MARK: - Terminal View

    private var terminalView: some View {
        VStack(spacing: 0) {
            // Terminal header
            terminalHeader

            // Terminal content
            ScrollViewReader { proxy in
                ScrollView {
                    if viewModel.isLoadingTerminal && viewModel.terminalContent == nil {
                        loadingView
                    } else if let content = viewModel.terminalContent {
                        terminalContent(content)
                            .id("terminalBottom")
                    } else if let error = viewModel.errorMessage {
                        errorView(error)
                    } else {
                        emptyTerminalView
                    }
                }
                .onChange(of: viewModel.terminalContent) { _, _ in
                    if viewModel.autoScrollEnabled {
                        withAnimation {
                            proxy.scrollTo("terminalBottom", anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    scrollProxy = proxy
                }
            }
            .background(CRTTheme.Background.panel.opacity(0.3))
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.top, CRTTheme.Spacing.md)
        .padding(.bottom, CRTTheme.Spacing.md)
    }

    private var terminalHeader: some View {
        HStack {
            CRTText("TERMINAL", style: .caption, glowIntensity: .subtle)

            if let session = viewModel.terminalSessionName {
                CRTText("[\(session)]", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            Spacer()

            if !viewModel.formattedTimestamp.isEmpty {
                CRTText(viewModel.formattedTimestamp, style: .caption, glowIntensity: .subtle, color: theme.dim)
            }

            if viewModel.isLoadingTerminal {
                LoadingIndicator(size: .small)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(theme.primary.opacity(0.1))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    private func terminalContent(_ content: String) -> some View {
        Text(content)
            .font(CRTTheme.Typography.font(size: 12))
            .foregroundColor(theme.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(CRTTheme.Spacing.sm)
            .textSelection(.enabled)
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            LoadingIndicator(size: .large)
            CRTText("LOADING TERMINAL...", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(CRTTheme.Spacing.xl)
    }

    private func errorView(_ error: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(CRTTheme.State.warning)

            CRTText("TERMINAL ERROR", style: .subheader, glowIntensity: .subtle, color: CRTTheme.State.warning)
            CRTText(error, style: .body, glowIntensity: .none, color: theme.dim)

            CRTButton("RETRY", variant: .secondary) {
                Task {
                    await viewModel.refreshTerminal()
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(CRTTheme.Spacing.xl)
    }

    private var emptyTerminalView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "terminal")
                .font(.system(size: 32))
                .foregroundColor(theme.dim)

            CRTText("NO OUTPUT", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("Terminal is empty or session not found.", style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(CRTTheme.Spacing.xl)
    }

    // MARK: - Status View (non-polecat)

    private var statusView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: agentIcon)
                .font(.system(size: 64))
                .foregroundColor(theme.dim)
                .crtGlow(color: theme.primary, radius: 8, intensity: 0.3)

            CRTText(viewModel.member.type.rawValue.uppercased(), style: .header, glowIntensity: .medium)

            if let task = viewModel.member.currentTask {
                CRTText(task, style: .body, glowIntensity: .subtle, color: theme.dim)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(CRTTheme.Spacing.xl)
    }

    private var agentIcon: String {
        switch viewModel.member.type {
        case .mayor: return "crown.fill"
        case .deacon: return "bell.fill"
        case .witness: return "eye.fill"
        case .refinery: return "gearshape.2.fill"
        case .crew: return "person.fill"
        case .polecat: return "terminal.fill"
        case .user: return "person.circle.fill"
        case .agent: return "cpu.fill"
        }
    }

    // MARK: - Toolbar Buttons

    @ViewBuilder
    private var toolbarButtons: some View {
        // Auto-scroll toggle
        Button {
            viewModel.autoScrollEnabled.toggle()
        } label: {
            Image(systemName: viewModel.autoScrollEnabled ? "arrow.down.to.line" : "arrow.down.to.line.alt")
                .foregroundColor(viewModel.autoScrollEnabled ? theme.primary : theme.dim)
        }
        .accessibilityLabel(viewModel.autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll")

        // Copy button
        Button {
            viewModel.copyTerminalContent()
        } label: {
            Image(systemName: "doc.on.doc")
                .foregroundColor(theme.primary)
        }
        .disabled(viewModel.terminalContent == nil)
        .accessibilityLabel("Copy terminal content")

        // Refresh button
        Button {
            Task {
                await viewModel.refreshTerminal()
            }
        } label: {
            if viewModel.isLoadingTerminal {
                LoadingIndicator(size: .small)
            } else {
                Image(systemName: "arrow.clockwise")
                    .foregroundColor(theme.primary)
            }
        }
        .disabled(viewModel.isLoadingTerminal)
        .accessibilityLabel("Refresh terminal")
    }

    // MARK: - Copy Confirmation

    @ViewBuilder
    private var copyConfirmationOverlay: some View {
        if viewModel.showCopyConfirmation {
            VStack {
                Spacer()

                HStack(spacing: CRTTheme.Spacing.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(CRTTheme.State.success)

                    CRTText("COPIED TO CLIPBOARD", style: .caption, glowIntensity: .medium, color: CRTTheme.State.success)
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .background(CRTTheme.Background.panel)
                .cornerRadius(CRTTheme.CornerRadius.md)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .stroke(CRTTheme.State.success.opacity(0.5), lineWidth: 1)
                )
                .crtGlow(color: CRTTheme.State.success, radius: 6, intensity: 0.4)
                .padding(.bottom, CRTTheme.Spacing.xl)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .animation(.easeInOut(duration: 0.3), value: viewModel.showCopyConfirmation)
        }
    }
}

// MARK: - Preview

#Preview("CrewDetailView - Polecat") {
    NavigationStack {
        CrewDetailView(
            member: CrewMember(
                id: "greenplace/polecat-abc",
                name: "polecat-abc",
                type: .polecat,
                rig: "greenplace",
                status: .working,
                currentTask: "Implementing feature adj-1234",
                unreadMail: 2,
                branch: "feature/adj-1234"
            )
        )
    }
}

#Preview("CrewDetailView - Mayor") {
    NavigationStack {
        CrewDetailView(
            member: CrewMember(
                id: "mayor/",
                name: "Mayor",
                type: .mayor,
                rig: nil,
                status: .working,
                currentTask: "Coordinating infrastructure",
                unreadMail: 5
            )
        )
    }
}

#Preview("CrewDetailView - Witness") {
    NavigationStack {
        CrewDetailView(
            member: CrewMember(
                id: "greenplace/witness",
                name: "Witness",
                type: .witness,
                rig: "greenplace",
                status: .idle,
                unreadMail: 0
            )
        )
    }
}
