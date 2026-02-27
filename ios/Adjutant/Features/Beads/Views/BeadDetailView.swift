import SwiftUI
import AdjutantKit

/// Comprehensive view showing all bead information.
/// Displays title, description, status, assignee, relationships, and timestamps.
struct BeadDetailView: View {
    @Environment(\.crtTheme) private var theme
    @EnvironmentObject private var coordinator: AppCoordinator
    @StateObject private var viewModel: BeadDetailViewModel

    init(beadId: String) {
        _viewModel = StateObject(wrappedValue: BeadDetailViewModel(beadId: beadId))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                if viewModel.isLoading {
                    LoadingIndicator()
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let bead = viewModel.bead {
                    // Header card with ID, type, priority
                    headerCard(bead)

                    // Title
                    titleCard(bead)

                    // Description (full text from detail endpoint)
                    if let description = viewModel.descriptionText {
                        descriptionCard(description)
                    }

                    // Status section
                    statusCard(bead)

                    // Agent state (if assigned and active)
                    if let agentState = viewModel.agentState {
                        agentStateCard(agentState)
                    }

                    // Parent epic
                    if let parentId = viewModel.parentEpicId {
                        parentEpicCard(parentId)
                    }

                    // Dependencies (blocks / blocked by)
                    if viewModel.hasDependencies {
                        dependenciesCard()
                    }

                    // Assignment section
                    assignmentCard(bead)

                    // Labels section (if any)
                    if !bead.labels.isEmpty {
                        labelsCard(bead)
                    }

                    // Timestamps (with closed date if available)
                    timestampsCard(bead)

                    // Pinned badge
                    if viewModel.isPinned {
                        pinnedBadge()
                    }
                } else if let error = viewModel.errorMessage {
                    errorView(error)
                }
            }
            .padding(CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .enableSwipeBack()
        #endif
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                CRTBackButton {
                    coordinator.pop()
                }
            }
            ToolbarItem(placement: .principal) {
                CRTText("BEAD DETAIL", style: .subheader, glowIntensity: .subtle)
            }
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Header Card

    @ViewBuilder
    private func headerCard(_ bead: BeadInfo) -> some View {
        CRTCard(header: "IDENTIFIER") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // ID with copy button
                HStack {
                    CRTText(bead.id, style: .mono, glowIntensity: .medium)
                        .foregroundColor(theme.bright)

                    Spacer()

                    copyButton(bead.id)
                }

                Divider()
                    .background(theme.dim.opacity(0.5))

                // Type and Priority
                HStack(spacing: CRTTheme.Spacing.md) {
                    BadgeView(bead.type.uppercased(), style: .tag)
                    BadgeView(viewModel.priorityText, style: .priority(bead.priority))

                    Spacer()

                    // Source indicator
                    HStack(spacing: CRTTheme.Spacing.xxs) {
                        CRTText("SOURCE:", style: .caption, glowIntensity: .none)
                            .foregroundColor(theme.dim)
                        CRTText(bead.source.uppercased(), style: .caption, glowIntensity: .subtle)
                    }
                }
            }
        }
    }

    // MARK: - Title Card

    @ViewBuilder
    private func titleCard(_ bead: BeadInfo) -> some View {
        CRTCard(header: "TITLE") {
            CRTText(bead.title, style: .body, glowIntensity: .medium)
                .fixedSize(horizontal: false, vertical: true)
        }
        .crtCardStyle(.elevated)
    }

    // MARK: - Description Card

    @ViewBuilder
    private func descriptionCard(_ description: String) -> some View {
        CRTCard(header: "DESCRIPTION") {
            CRTText(description, style: .body, glowIntensity: .subtle)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Agent State Card

    @ViewBuilder
    private func agentStateCard(_ state: String) -> some View {
        CRTCard(header: "AGENT STATUS") {
            HStack(spacing: CRTTheme.Spacing.sm) {
                StatusDot(agentStateStatusType(for: state), pulse: state == "working")
                CRTText(state.uppercased(), style: .subheader, glowIntensity: .medium)
                    .foregroundColor(agentStateColor(for: state))
                Spacer()
            }
        }
    }

    // MARK: - Parent Epic Card

    @ViewBuilder
    private func parentEpicCard(_ parentId: String) -> some View {
        CRTCard(header: "PARENT EPIC") {
            Button {
                coordinator.navigate(to: .beadDetail(id: parentId))
            } label: {
                HStack(spacing: CRTTheme.Spacing.sm) {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 12))
                        .foregroundColor(theme.dim)
                    CRTText(parentId, style: .mono, glowIntensity: .medium)
                        .foregroundColor(theme.bright)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundColor(theme.dim)
                }
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Dependencies Card

    @ViewBuilder
    private func dependenciesCard() -> some View {
        CRTCard(header: "DEPENDENCIES") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                // Blocks section
                if !viewModel.blocksDeps.isEmpty {
                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                        CRTText("BLOCKS", style: .caption, glowIntensity: .subtle)
                            .foregroundColor(theme.dim)
                        FlowLayout(spacing: CRTTheme.Spacing.xs) {
                            ForEach(viewModel.blocksDeps, id: \.issueId) { dep in
                                dependencyButton(dep.issueId)
                            }
                        }
                    }
                }

                // Blocked by section
                if !viewModel.blockedByDeps.isEmpty {
                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                        CRTText("BLOCKED BY", style: .caption, glowIntensity: .subtle)
                            .foregroundColor(theme.dim)
                        FlowLayout(spacing: CRTTheme.Spacing.xs) {
                            ForEach(viewModel.blockedByDeps, id: \.dependsOnId) { dep in
                                dependencyButton(dep.dependsOnId)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func dependencyButton(_ beadId: String) -> some View {
        Button {
            coordinator.navigate(to: .beadDetail(id: beadId))
        } label: {
            CRTText(beadId, style: .mono, glowIntensity: .subtle)
                .foregroundColor(theme.bright)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xxs)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(theme.dim.opacity(0.5), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Pinned Badge

    @ViewBuilder
    private func pinnedBadge() -> some View {
        HStack {
            Image(systemName: "pin.fill")
                .font(.system(size: 12))
            CRTText("PINNED", style: .caption, glowIntensity: .subtle)
        }
        .foregroundColor(CRTTheme.State.warning)
        .padding(CRTTheme.Spacing.sm)
        .frame(maxWidth: .infinity)
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(CRTTheme.State.warning.opacity(0.5), lineWidth: 1)
        )
    }

    // MARK: - Status Card

    @ViewBuilder
    private func statusCard(_ bead: BeadInfo) -> some View {
        CRTCard(header: "STATUS") {
            HStack(spacing: CRTTheme.Spacing.md) {
                // Status indicator dot
                StatusDot(statusType(for: bead.status), pulse: bead.status == "in_progress")

                // Status text
                CRTText(viewModel.statusText, style: .subheader, glowIntensity: .medium)
                    .foregroundColor(statusColor(for: bead.status))

                Spacer()
            }
        }
    }

    // MARK: - Assignment Card

    @ViewBuilder
    private func assignmentCard(_ bead: BeadInfo) -> some View {
        CRTCard(header: "ASSIGNMENT") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                // Assignee
                HStack {
                    CRTText("ASSIGNEE:", style: .caption, glowIntensity: .subtle)
                        .foregroundColor(theme.dim)
                    if let assignee = viewModel.formattedAssignee {
                        CRTText(assignee, style: .body, glowIntensity: .subtle)
                    } else {
                        CRTText("Unassigned", style: .body, glowIntensity: .none)
                            .foregroundColor(theme.dim)
                    }

                    Spacer()

                    // ASSIGN / REASSIGN button (hidden on closed beads)
                    if bead.status != "closed" {
                        CRTButton(
                            viewModel.formattedAssignee != nil ? "REASSIGN" : "ASSIGN",
                            variant: .secondary,
                            size: .small
                        ) {
                            viewModel.showingAgentPicker = true
                        }
                    }
                }

                // Full path (if assigned)
                if let fullPath = viewModel.fullAssignee {
                    HStack {
                        CRTText("PATH:", style: .caption, glowIntensity: .subtle)
                            .foregroundColor(theme.dim)
                        CRTText(fullPath, style: .mono, glowIntensity: .none)
                            .foregroundColor(theme.dim)
                            .font(CRTTheme.Typography.font(size: 10))
                    }
                }

                // Rig
                if let rig = bead.rig {
                    HStack {
                        CRTText("RIG:", style: .caption, glowIntensity: .subtle)
                            .foregroundColor(theme.dim)
                        CRTText(rig.uppercased(), style: .body, glowIntensity: .subtle)
                    }
                }
            }
        }
        .sheet(isPresented: $viewModel.showingAgentPicker) {
            AgentPickerView { agent in
                Task {
                    await viewModel.assignBead(to: agent)
                }
            }
        }
    }

    // MARK: - Labels Card

    @ViewBuilder
    private func labelsCard(_ bead: BeadInfo) -> some View {
        CRTCard(header: "LABELS", headerBadge: "\(bead.labels.count)") {
            FlowLayout(spacing: CRTTheme.Spacing.xs) {
                ForEach(bead.labels, id: \.self) { label in
                    BadgeView(label.uppercased(), style: .label)
                }
            }
        }
    }

    // MARK: - Timestamps Card

    @ViewBuilder
    private func timestampsCard(_ bead: BeadInfo) -> some View {
        CRTCard(header: "TIMESTAMPS") {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                timestampRow("CREATED:", value: viewModel.formattedCreatedDate)
                timestampRow("UPDATED:", value: viewModel.formattedUpdatedDate)
                if let closedDate = viewModel.formattedClosedDate {
                    timestampRow("CLOSED:", value: closedDate)
                }
            }
        }
        .crtCardStyle(.minimal)
    }

    @ViewBuilder
    private func timestampRow(_ label: String, value: String) -> some View {
        HStack {
            CRTText(label, style: .caption, glowIntensity: .subtle)
                .foregroundColor(theme.dim)
                .frame(width: 80, alignment: .leading)
            CRTText(value, style: .body, glowIntensity: .subtle)
        }
    }

    // MARK: - Error View

    @ViewBuilder
    private func errorView(_ error: String) -> some View {
        CRTCard {
            VStack(spacing: CRTTheme.Spacing.md) {
                CRTText("ERROR", style: .subheader, color: CRTTheme.State.error)
                CRTText(error, style: .body, glowIntensity: .subtle)
                    .foregroundColor(theme.dim)

                CRTButton("RETRY", variant: .secondary) {
                    Task {
                        await viewModel.loadBead()
                    }
                }
            }
        }
    }

    // MARK: - Helper Views

    @ViewBuilder
    private func copyButton(_ text: String) -> some View {
        Button {
            #if os(iOS)
            UIPasteboard.general.string = text
            #elseif os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            #endif
        } label: {
            Image(systemName: "doc.on.doc")
                .font(.system(size: 14))
                .foregroundColor(theme.dim)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Copy bead ID")
    }

    // MARK: - Helpers

    private func statusType(for status: String) -> BadgeView.Style.StatusType {
        switch status {
        case "closed": return .offline
        case "blocked": return .warning
        case "hooked", "in_progress": return .info
        case "open": return .success
        default: return .info
        }
    }

    private func statusColor(for status: String) -> Color {
        switch status {
        case "closed": return CRTTheme.State.offline
        case "blocked": return CRTTheme.State.warning
        case "hooked", "in_progress": return CRTTheme.State.info
        case "open": return CRTTheme.State.success
        default: return theme.primary
        }
    }

    private func agentStateStatusType(for state: String) -> BadgeView.Style.StatusType {
        switch state {
        case "working": return .success
        case "stuck": return .warning
        case "stale": return .warning
        case "idle": return .info
        default: return .offline
        }
    }

    private func agentStateColor(for state: String) -> Color {
        switch state {
        case "working": return CRTTheme.State.success
        case "stuck": return CRTTheme.State.error
        case "stale": return CRTTheme.State.warning
        case "idle": return CRTTheme.State.info
        default: return theme.dim
        }
    }
}

// MARK: - Flow Layout for Labels

/// Simple flow layout for wrapping label badges
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrangeSubviews(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrangeSubviews(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)

            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }

            positions.append(CGPoint(x: currentX, y: currentY))
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
            maxX = max(maxX, currentX - spacing)
        }

        return (CGSize(width: maxX, height: currentY + lineHeight), positions)
    }
}

// MARK: - Preview

#Preview("Bead Detail - Feature") {
    NavigationStack {
        BeadDetailView(beadId: "adj-001")
    }
    .environmentObject(AppCoordinator())
}

#Preview("Bead Detail - Bug") {
    NavigationStack {
        BeadDetailView(beadId: "adj-002")
    }
    .environmentObject(AppCoordinator())
}
