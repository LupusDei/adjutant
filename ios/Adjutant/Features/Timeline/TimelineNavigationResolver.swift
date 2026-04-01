import AdjutantKit

/// Maps timeline events to navigation destinations for deep linking.
/// Used by context menus and tap actions on timeline rows to navigate
/// to the relevant detail view (agent, bead, proposal, etc.).
struct TimelineNavigationResolver {

    /// Determine the navigation target for a timeline event.
    /// Returns nil if the event has no actionable navigation target.
    static func resolve(_ event: TimelineEvent) -> AppRoute? {
        switch event.eventType {
        case "message_sent":
            guard !event.agentId.isEmpty else { return nil }
            return .agentDetailById(id: event.agentId)

        case "status_change", "progress_report", "announcement":
            guard !event.agentId.isEmpty else { return nil }
            return .agentDetailById(id: event.agentId)

        case "bead_updated", "bead_closed":
            guard let beadId = event.beadId, !beadId.isEmpty else { return nil }
            return .beadDetail(id: beadId)

        case "proposal_completed":
            guard let proposalId = event.detail?["proposalId"]?.stringValue,
                  !proposalId.isEmpty else { return nil }
            return .proposalDetail(id: proposalId)

        case "coordinator_action":
            if let target = event.detail?["target"]?.stringValue, !target.isEmpty {
                return .agentDetailById(id: target)
            }
            return nil

        case "auto_develop_enabled", "auto_develop_disabled", "auto_develop_phase_changed":
            // Project-scoped events — no detail view navigation yet
            return nil

        default:
            return nil
        }
    }

    /// Human-readable label for the navigation action (used in context menus).
    static func actionLabel(_ event: TimelineEvent) -> String? {
        guard let route = resolve(event) else { return nil }
        switch route {
        case .agentDetailById(let id):
            if event.eventType == "message_sent" {
                return "Open Chat with \(event.agentId.isEmpty ? id : event.agentId)"
            }
            return "View Agent \(event.agentId.isEmpty ? id : event.agentId)"
        case .beadDetail(let id):
            return "View Bead \(id)"
        case .proposalDetail:
            return "View Proposal"
        case .epicDetail(let id):
            return "View Epic \(id)"
        default:
            return "View Details"
        }
    }

    /// SF Symbol icon name for the navigation action.
    static func actionIcon(_ event: TimelineEvent) -> String? {
        guard resolve(event) != nil else { return nil }
        switch event.eventType {
        case "message_sent":
            return "bubble.left.fill"
        case "status_change", "progress_report", "announcement", "coordinator_action":
            return "person.fill"
        case "bead_updated", "bead_closed":
            return "circle.grid.3x3"
        case "proposal_completed":
            return "doc.text.fill"
        default:
            return "arrow.right.circle"
        }
    }
}
