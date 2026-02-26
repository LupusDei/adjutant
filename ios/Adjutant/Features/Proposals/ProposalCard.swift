import SwiftUI
import AdjutantKit

/// A card view for displaying a single proposal with type badge,
/// metadata, description preview, and contextual swipe actions.
struct ProposalCard: View {
    @Environment(\.crtTheme) private var theme

    let proposal: Proposal
    let onAccept: (() -> Void)?
    let onDismiss: (() -> Void)?
    let onComplete: (() -> Void)?
    let onDiscuss: (() -> Void)?

    init(
        proposal: Proposal,
        onAccept: (() -> Void)? = nil,
        onDismiss: (() -> Void)? = nil,
        onComplete: (() -> Void)? = nil,
        onDiscuss: (() -> Void)? = nil
    ) {
        self.proposal = proposal
        self.onAccept = onAccept
        self.onDismiss = onDismiss
        self.onComplete = onComplete
        self.onDiscuss = onDiscuss
    }

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            // Header: title + type badge
            headerRow

            // Author and date
            metadataRow

            // Description preview (3 lines)
            descriptionText

            // Status indicator for non-pending proposals
            if proposal.status != .pending {
                statusRow
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(theme.background.elevated)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(borderColor.opacity(0.4), lineWidth: 1)
        )
        .cornerRadius(CRTTheme.CornerRadius.md)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            if proposal.status == .pending, let onDismiss {
                Button(role: .destructive) {
                    onDismiss()
                } label: {
                    Label("Dismiss", systemImage: "xmark")
                }
                .tint(CRTTheme.State.error)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if proposal.status == .pending, let onAccept {
                Button {
                    onAccept()
                } label: {
                    Label("Accept", systemImage: "checkmark")
                }
                .tint(CRTTheme.State.success)
            }
            if proposal.status == .pending, let onDiscuss {
                Button {
                    onDiscuss()
                } label: {
                    Label("Discuss", systemImage: "bubble.left.and.bubble.right")
                }
                .tint(CRTTheme.State.warning)
            }
            if proposal.status == .accepted, let onComplete {
                Button {
                    onComplete()
                } label: {
                    Label("Complete", systemImage: "checkmark.circle.fill")
                }
                .tint(CRTTheme.State.info)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // MARK: - Subviews

    private var headerRow: some View {
        HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
            // Title
            Text(proposal.title)
                .font(CRTTheme.Typography.font(size: 14, weight: .bold))
                .foregroundColor(theme.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Type badge
            typeBadge
        }
    }

    private var typeBadge: some View {
        Text(proposal.type.rawValue.uppercased())
            .font(CRTTheme.Typography.font(size: 9, weight: .bold))
            .tracking(CRTTheme.Typography.letterSpacing)
            .foregroundColor(typeBadgeColor)
            .padding(.horizontal, CRTTheme.Spacing.xxs + 2)
            .padding(.vertical, 2)
            .background(typeBadgeColor.opacity(0.15))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(typeBadgeColor.opacity(0.4), lineWidth: 1)
            )
            .cornerRadius(CRTTheme.CornerRadius.sm)
            .crtGlow(color: typeBadgeColor, radius: 2, intensity: 0.2)
    }

    private var metadataRow: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            // Author
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Image(systemName: "person.fill")
                    .font(.system(size: 9))
                Text(proposal.author)
                    .font(CRTTheme.Typography.font(size: 11, weight: .medium))
            }
            .foregroundColor(theme.dim)

            Spacer()

            // Relative date
            Text(proposal.relativeDate)
                .font(CRTTheme.Typography.font(size: 10))
                .foregroundColor(theme.dim)
        }
    }

    private var descriptionText: some View {
        Text(proposal.description)
            .font(CRTTheme.Typography.font(size: 12))
            .foregroundColor(theme.primary.opacity(0.7))
            .lineLimit(3)
            .lineSpacing(2)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusRow: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            Circle()
                .fill(statusColor)
                .frame(width: 6, height: 6)
            Text(proposal.status.rawValue.uppercased())
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(statusColor)
        }
        .crtGlow(color: statusColor, radius: 2, intensity: 0.3)
    }

    // MARK: - Computed Properties

    private var typeBadgeColor: Color {
        switch proposal.type {
        case .product:
            return CRTTheme.State.success
        case .engineering:
            return CRTTheme.State.warning
        }
    }

    private var statusColor: Color {
        switch proposal.status {
        case .pending:
            return theme.primary
        case .accepted:
            return CRTTheme.State.success
        case .completed:
            return CRTTheme.State.info
        case .dismissed:
            return CRTTheme.State.error
        }
    }

    private var borderColor: Color {
        switch proposal.status {
        case .pending:
            return theme.dim
        case .accepted:
            return CRTTheme.State.success
        case .completed:
            return CRTTheme.State.info
        case .dismissed:
            return CRTTheme.State.error
        }
    }

    private var accessibilityLabel: String {
        var label = "\(proposal.title), \(proposal.type.rawValue) proposal by \(proposal.author)"
        label += ", \(proposal.status.rawValue)"
        if proposal.status == .pending {
            label += ". Swipe right to accept or discuss, swipe left to dismiss."
        }
        return label
    }
}

// MARK: - Preview

#Preview("ProposalCard - Pending Product") {
    ProposalCard(
        proposal: Proposal(
            id: "uuid-001",
            author: "adjutant/polecats/flint",
            title: "Add voice commands for hands-free operation",
            description: "Users should be able to control the dashboard using voice commands. This would improve accessibility and allow hands-free operation during complex workflows.",
            type: .product,
            status: .pending,
            createdAt: "2026-02-24T10:00:00Z",
            updatedAt: "2026-02-24T10:00:00Z"
        ),
        onAccept: {},
        onDismiss: {}
    )
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("ProposalCard - Accepted Engineering") {
    ProposalCard(
        proposal: Proposal(
            id: "uuid-002",
            author: "gastown/witness",
            title: "Migrate database to PostgreSQL",
            description: "SQLite is hitting write contention limits under swarm load. PostgreSQL would provide better concurrent write performance and WAL replication for read replicas.",
            type: .engineering,
            status: .accepted,
            createdAt: "2026-02-23T15:30:00Z",
            updatedAt: "2026-02-24T08:00:00Z"
        )
    )
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("ProposalCard - Dismissed") {
    ProposalCard(
        proposal: Proposal(
            id: "uuid-003",
            author: "gastown/refinery",
            title: "Add dark mode toggle",
            description: "Already a CRT terminal. This is inherently dark mode.",
            type: .product,
            status: .dismissed,
            createdAt: "2026-02-22T09:00:00Z",
            updatedAt: "2026-02-22T09:30:00Z"
        )
    )
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
