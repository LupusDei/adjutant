import SwiftUI
import AdjutantKit

/// Detail view for an agent with tabbed layout: INFO, BEADS, MESSAGES.
/// Shows agent header with status, type badge, and tabbed content sections.
/// Includes agent lifecycle controls (terminate, assign bead).
struct AgentDetailView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel: AgentDetailViewModel
    @State private var scrollProxy: ScrollViewProxy?

    init(member: CrewMember) {
        _viewModel = StateObject(wrappedValue: AgentDetailViewModel(member: member))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Agent info header
            agentHeader

            // Tab selector
            tabSelector

            // Tab content
            tabContent
        }
        .background(CRTTheme.Background.screen)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        #endif
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                CRTBackButton {
                    coordinator.pop()
                }
            }

            ToolbarItem(placement: .principal) {
                CRTText(viewModel.member.name.uppercased(), style: .subheader, glowIntensity: .subtle)
            }

            #if os(iOS)
            ToolbarItemGroup(placement: .navigationBarTrailing) {
                toolbarButtons
            }
            #else
            ToolbarItemGroup(placement: .automatic) {
                toolbarButtons
            }
            #endif
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .onChange(of: viewModel.selectedTab) { _, newTab in
            switch newTab {
            case .beads:
                if viewModel.activeBeads.isEmpty && viewModel.completedBeads.isEmpty {
                    Task { await viewModel.loadBeads() }
                }
            case .messages:
                if viewModel.messages.isEmpty {
                    Task { await viewModel.loadMessages() }
                }
            case .info:
                break
            }
        }
        .onChange(of: viewModel.didTerminate) { _, didTerminate in
            if didTerminate {
                dismiss()
            }
        }
        .alert("TERMINATE \(viewModel.member.name.uppercased())?", isPresented: $viewModel.showTerminateConfirmation) {
            Button("CANCEL", role: .cancel) { }
            Button("TERMINATE", role: .destructive) {
                Task { await viewModel.terminateAgent() }
            }
        } message: {
            Text("This action cannot be undone. The agent session will be killed.")
        }
        .sheet(isPresented: $viewModel.showBeadPicker) {
            BeadPickerSheet(viewModel: viewModel)
        }
        .overlay(copyConfirmationOverlay)
    }

    // MARK: - Agent Header

    private var agentHeader: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Status dot and name
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    StatusDot(statusType, size: 12, pulse: shouldPulse)
                    CRTText(viewModel.member.name, style: .subheader, glowIntensity: .medium)
                }

                HStack(spacing: CRTTheme.Spacing.xs) {
                    BadgeView(viewModel.member.type.rawValue.uppercased(), style: .tag)

                    if let rig = viewModel.member.rig {
                        CRTText("[\(rig)]", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    }
                }
            }

            Spacer()

            // Status badge
            BadgeView(viewModel.statusDisplayText, style: .status(statusType))
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

    // MARK: - Tab Selector

    private var tabSelector: some View {
        HStack(spacing: 0) {
            ForEach(AgentDetailViewModel.Tab.allCases) { tab in
                tabButton(tab)
            }
        }
        .background(CRTTheme.Background.panel.opacity(0.5))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.dim.opacity(0.3)),
            alignment: .bottom
        )
    }

    private func tabButton(_ tab: AgentDetailViewModel.Tab) -> some View {
        let isSelected = viewModel.selectedTab == tab

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                viewModel.selectedTab = tab
            }
        } label: {
            VStack(spacing: CRTTheme.Spacing.xxs) {
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    CRTText(
                        tab.rawValue,
                        style: .caption,
                        glowIntensity: isSelected ? .medium : .subtle,
                        color: isSelected ? theme.primary : theme.dim
                    )

                    // Badge counts
                    if tab == .beads && viewModel.totalBeadCount > 0 {
                        tabBadge(viewModel.totalBeadCount)
                    } else if tab == .messages && viewModel.messageCount > 0 {
                        tabBadge(viewModel.messageCount)
                    }
                }

                // Active indicator line
                Rectangle()
                    .fill(isSelected ? theme.primary : Color.clear)
                    .frame(height: 2)
                    .crtGlow(color: theme.primary, radius: isSelected ? 4 : 0, intensity: isSelected ? 0.4 : 0)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, CRTTheme.Spacing.xs)
        }
        .buttonStyle(.plain)
    }

    private func tabBadge(_ count: Int) -> some View {
        Text("\(count)")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundColor(CRTTheme.Background.screen)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(theme.dim)
            .clipShape(Capsule())
    }

    // MARK: - Tab Content

    @ViewBuilder
    private var tabContent: some View {
        switch viewModel.selectedTab {
        case .info:
            infoTabContent
        case .beads:
            beadsTabContent
        case .messages:
            messagesTabContent
        }
    }

    // MARK: - INFO Tab

    private var infoTabContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                // Agent details card
                infoCard

                // Terminal for polecats
                if viewModel.hasTerm {
                    terminalCard
                } else {
                    agentTypeCard
                }

                // Terminate button at bottom
                if viewModel.canTerminate {
                    terminateButton
                }

                // Assign bead button
                assignBeadButton
            }
            .padding(CRTTheme.Spacing.md)
        }
    }

    private var infoCard: some View {
        CRTCard(header: "STATUS") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Status with colored indicator
                HStack(spacing: CRTTheme.Spacing.sm) {
                    StatusDot(statusType, size: 14, pulse: shouldPulse)
                    CRTText(viewModel.statusDisplayText, style: .body, glowIntensity: .medium)
                        .foregroundColor(statusColor)

                    Spacer()

                    BadgeView(viewModel.member.type.rawValue.uppercased(), style: .tag)
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

                    if let sessionId = viewModel.member.sessionId {
                        detailRow(label: "SESSION", value: String(sessionId.prefix(12)) + "...")
                    }

                    if (viewModel.member.unreadMail ?? 0) > 0 {
                        detailRow(label: "UNREAD", value: "\(viewModel.member.unreadMail ?? 0) MESSAGES")
                    }
                }
            }
        }
    }

    private var terminalCard: some View {
        CRTCard(header: "TERMINAL") {
            VStack(spacing: 0) {
                // Terminal header info
                HStack {
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
                .padding(.bottom, CRTTheme.Spacing.xs)

                // Terminal content
                if viewModel.isLoadingTerminal && viewModel.terminalContent == nil {
                    VStack(spacing: CRTTheme.Spacing.sm) {
                        LoadingIndicator(size: .medium)
                        CRTText("LOADING TERMINAL...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    }
                    .frame(maxWidth: .infinity, minHeight: 120)
                } else if let content = viewModel.terminalContent {
                    ScrollView {
                        Text(content)
                            .font(CRTTheme.Typography.font(size: 11))
                            .foregroundColor(theme.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 200)
                    .background(CRTTheme.Background.screen.opacity(0.5))
                    .cornerRadius(CRTTheme.CornerRadius.sm)
                } else if let error = viewModel.errorMessage {
                    CRTText(error, style: .caption, glowIntensity: .subtle, color: CRTTheme.State.warning)
                        .frame(maxWidth: .infinity, minHeight: 60)
                } else {
                    CRTText("NO OUTPUT", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .frame(maxWidth: .infinity, minHeight: 60)
                }
            }
        }
    }

    private var agentTypeCard: some View {
        CRTCard {
            HStack {
                Image(systemName: agentIcon)
                    .font(.system(size: 32))
                    .foregroundColor(theme.dim)
                    .crtGlow(color: theme.primary, radius: 6, intensity: 0.3)

                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                    CRTText(viewModel.member.type.rawValue.uppercased(), style: .subheader, glowIntensity: .medium)

                    if let task = viewModel.member.currentTask {
                        CRTText(task, style: .caption, glowIntensity: .subtle, color: theme.dim)
                            .lineLimit(2)
                    }
                }

                Spacer()
            }
        }
    }

    private var terminateButton: some View {
        CRTButton("TERMINATE", variant: .danger, isLoading: viewModel.isPerformingAction) {
            viewModel.showTerminateConfirmation = true
        }
        .frame(maxWidth: .infinity)
        .disabled(viewModel.isPerformingAction)
    }

    private var assignBeadButton: some View {
        CRTButton("ASSIGN BEAD", variant: .secondary) {
            viewModel.showBeadPicker = true
            Task { await viewModel.loadUnassignedBeads() }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - BEADS Tab

    private var beadsTabContent: some View {
        Group {
            if viewModel.isLoadingBeads {
                VStack(spacing: CRTTheme.Spacing.md) {
                    Spacer()
                    LoadingIndicator(size: .large)
                    CRTText("LOADING BEADS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else if viewModel.activeBeads.isEmpty && viewModel.completedBeads.isEmpty {
                beadsEmptyState
            } else {
                beadsList
            }
        }
    }

    private var beadsEmptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Spacer()

            Image(systemName: "circle.grid.3x3")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO ASSIGNED BEADS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("This agent has no beads assigned.", style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))

            CRTButton("ASSIGN BEAD", variant: .secondary) {
                viewModel.showBeadPicker = true
                Task { await viewModel.loadUnassignedBeads() }
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(CRTTheme.Spacing.xl)
    }

    private var beadsList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.sm) {
                // Active beads section
                if !viewModel.activeBeads.isEmpty {
                    beadSectionHeader("ACTIVE", count: viewModel.activeBeads.count)

                    ForEach(viewModel.activeBeads) { bead in
                        agentBeadRow(bead)
                    }
                }

                // Completed beads section
                if !viewModel.completedBeads.isEmpty {
                    beadSectionHeader("COMPLETED", count: viewModel.completedBeads.count)

                    ForEach(viewModel.completedBeads) { bead in
                        agentBeadRow(bead)
                    }
                }
            }
            .padding(CRTTheme.Spacing.md)
        }
        .refreshable {
            await viewModel.loadBeads()
        }
    }

    private func beadSectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            CRTText(title, style: .caption, glowIntensity: .subtle, color: theme.dim)

            Rectangle()
                .fill(theme.dim.opacity(0.3))
                .frame(height: 1)

            CRTText("\(count)", style: .caption, glowIntensity: .subtle, color: theme.dim)
        }
        .padding(.top, CRTTheme.Spacing.xs)
    }

    private func agentBeadRow(_ bead: BeadInfo) -> some View {
        Button {
            coordinator.navigate(to: .beadDetail(id: bead.id))
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // Status dot
                StatusDot(beadStatusType(bead.status), size: 8, pulse: bead.status == "in_progress")

                // Bead ID badge
                Text(bead.id)
                    .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                    .foregroundColor(theme.dim)

                // Title
                Text(bead.title)
                    .font(CRTTheme.Typography.font(size: 13, weight: .medium))
                    .foregroundColor(theme.primary)
                    .lineLimit(1)

                Spacer()

                // Priority
                BadgeView("P\(bead.priority)", style: .priority(bead.priority))

                // Chevron
                Image(systemName: "chevron.right")
                    .font(.system(size: 10))
                    .foregroundColor(theme.dim)
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(CRTTheme.Background.panel.opacity(0.3))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.primary.opacity(0.15), lineWidth: 1)
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
        }
        .buttonStyle(.plain)
    }

    // MARK: - MESSAGES Tab

    private var messagesTabContent: some View {
        VStack(spacing: 0) {
            if viewModel.isLoadingMessages && viewModel.messages.isEmpty {
                VStack(spacing: CRTTheme.Spacing.md) {
                    Spacer()
                    LoadingIndicator(size: .large)
                    CRTText("LOADING MESSAGES...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else if viewModel.messages.isEmpty {
                messagesEmptyState
            } else {
                messagesList
            }

            // Quick reply input
            messageInput
        }
    }

    private var messagesEmptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Spacer()

            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO MESSAGES", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("Send a message to start a conversation.", style: .body, glowIntensity: .none, color: theme.dim.opacity(0.6))

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(CRTTheme.Spacing.xl)
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: CRTTheme.Spacing.sm) {
                    ForEach(viewModel.messages) { message in
                        agentMessageBubble(message)
                            .id(message.id)
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("messagesBottom")
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
            }
            .onAppear {
                proxy.scrollTo("messagesBottom", anchor: .bottom)
            }
            .onChange(of: viewModel.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo("messagesBottom", anchor: .bottom)
                }
            }
        }
    }

    private func agentMessageBubble(_ message: PersistentMessage) -> some View {
        let isOutgoing = message.isFromUser

        return HStack {
            if isOutgoing {
                Spacer(minLength: 60)
            }

            VStack(alignment: isOutgoing ? .trailing : .leading, spacing: CRTTheme.Spacing.xxs) {
                // Sender label for incoming
                if !isOutgoing {
                    CRTText(message.senderName.uppercased(), style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                }

                // Message bubble
                Text(message.body)
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                            .fill(isOutgoing ? theme.primary.opacity(0.2) : CRTTheme.Background.elevated)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                            .stroke(
                                isOutgoing ? theme.primary.opacity(0.6) : theme.dim.opacity(0.6),
                                lineWidth: 1
                            )
                    )

                // Timestamp
                if let date = message.date {
                    CRTText(
                        formatTimestamp(date),
                        style: .caption,
                        glowIntensity: .none,
                        color: theme.dim.opacity(0.6)
                    )
                }
            }

            if !isOutgoing {
                Spacer(minLength: 60)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
    }

    private var messageInput: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            // Text input
            TextField("", text: $viewModel.messageInputText, prompt: messagePrompt, axis: .vertical)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                .lineLimit(1...3)
                .onSubmit {
                    if viewModel.canSendMessage {
                        Task { await viewModel.sendMessage() }
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                        .fill(CRTTheme.Background.elevated.opacity(0.5))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                        .stroke(theme.dim.opacity(0.3), lineWidth: 1)
                )

            // Send button
            Button {
                Task { await viewModel.sendMessage() }
            } label: {
                if viewModel.isSendingMessage {
                    LoadingIndicator(size: .small)
                        .frame(width: 32, height: 32)
                } else {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(viewModel.canSendMessage ? theme.primary : theme.dim.opacity(0.3))
                }
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSendMessage)
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            Rectangle()
                .fill(CRTTheme.Background.panel)
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .top
                )
        )
    }

    private var messagePrompt: Text {
        Text("MESSAGE \(viewModel.member.name.uppercased())...")
            .foregroundColor(theme.dim.opacity(0.5))
    }

    // MARK: - Toolbar Buttons

    @ViewBuilder
    private var toolbarButtons: some View {
        if viewModel.selectedTab == .info && viewModel.hasTerm {
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
                Task { await viewModel.refreshTerminal() }
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

    // MARK: - Helpers

    private var statusType: BadgeView.Style.StatusType {
        switch viewModel.member.status {
        case .idle: return .info
        case .working: return .success
        case .blocked: return .warning
        case .stuck: return .error
        case .offline: return .offline
        }
    }

    private var shouldPulse: Bool {
        viewModel.member.status == .working || viewModel.member.status == .stuck
    }

    private var statusColor: Color {
        statusType.color
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

    private func detailRow(label: String, value: String) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            CRTText(label + ":", style: .caption, glowIntensity: .subtle, color: theme.dim)
                .frame(width: 70, alignment: .leading)
            CRTText(value, style: .body, glowIntensity: .subtle)
                .lineLimit(2)
        }
    }

    private func beadStatusType(_ status: String) -> BadgeView.Style.StatusType {
        switch status.lowercased() {
        case "closed": return .offline
        case "blocked": return .warning
        case "hooked", "in_progress": return .info
        case "open": return .success
        default: return .success
        }
    }

    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            formatter.dateFormat = "HH:mm"
        } else if calendar.isDateInYesterday(date) {
            formatter.dateFormat = "'YESTERDAY' HH:mm"
        } else {
            formatter.dateFormat = "MMM d, HH:mm"
        }

        return formatter.string(from: date).uppercased()
    }
}

// MARK: - Bead Picker Sheet

/// CRT-themed sheet for selecting an unassigned bead to assign to an agent.
private struct BeadPickerSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: AgentDetailViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if viewModel.isLoadingUnassignedBeads {
                    Spacer()
                    LoadingIndicator(size: .medium)
                    CRTText("SCANNING BEADS...", style: .caption, glowIntensity: .subtle, color: theme.dim)
                        .padding(.top, CRTTheme.Spacing.sm)
                    Spacer()
                } else if viewModel.unassignedBeads.isEmpty {
                    Spacer()
                    VStack(spacing: CRTTheme.Spacing.sm) {
                        Image(systemName: "circle.grid.3x3")
                            .font(.system(size: 36))
                            .foregroundColor(theme.dim)
                        CRTText("NO UNASSIGNED BEADS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
                        CRTText("All open beads are already assigned.", style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
                    }
                    Spacer()
                } else {
                    beadList
                }
            }
            .background(CRTTheme.Background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("ASSIGN BEAD", style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        CRTText("CANCEL", style: .caption, color: theme.dim)
                    }
                }
            }
        }
    }

    private var beadList: some View {
        ScrollView {
            LazyVStack(spacing: CRTTheme.Spacing.xs) {
                ForEach(viewModel.unassignedBeads) { bead in
                    beadRow(bead)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
    }

    private func beadRow(_ bead: BeadInfo) -> some View {
        Button {
            #if canImport(UIKit)
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            #endif
            Task {
                await viewModel.assignBead(bead.id)
            }
            dismiss()
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                // ID badge
                Text(bead.id)
                    .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                    .foregroundColor(theme.dim)

                // Type badge
                BadgeView(bead.type.uppercased(), style: .tag)

                // Title
                VStack(alignment: .leading, spacing: 2) {
                    Text(bead.title)
                        .font(CRTTheme.Typography.font(size: 13, weight: .medium))
                        .foregroundColor(theme.primary)
                        .lineLimit(1)
                }

                Spacer()

                // Priority
                BadgeView("P\(bead.priority)", style: .priority(bead.priority))
            }
            .padding(.vertical, CRTTheme.Spacing.sm)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(theme.dim.opacity(0.05))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(theme.primary.opacity(0.15), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview

#Preview("AgentDetailView - Polecat") {
    NavigationStack {
        AgentDetailView(
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
    .environmentObject(AppCoordinator())
}

#Preview("AgentDetailView - Agent") {
    NavigationStack {
        AgentDetailView(
            member: CrewMember(
                id: "adjutant/agent/toast",
                name: "Toast",
                type: .agent,
                rig: "adjutant",
                status: .working,
                currentTask: "Building iOS features",
                unreadMail: 3,
                branch: "feat/018-ios",
                sessionId: "session-abc123"
            )
        )
    }
    .environmentObject(AppCoordinator())
}

#Preview("AgentDetailView - Offline") {
    NavigationStack {
        AgentDetailView(
            member: CrewMember(
                id: "greenplace/witness",
                name: "Witness",
                type: .witness,
                rig: "greenplace",
                status: .offline,
                unreadMail: 0
            )
        )
    }
    .environmentObject(AppCoordinator())
}
