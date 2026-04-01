import AdjutantKit

/// A single navigation action available from a timeline event context menu.
struct TimelineAction {
    let label: String
    let icon: String
    let route: AppRoute
    /// If true, this action should switch to the Chat tab with the agent pre-selected.
    let isChatNavigation: Bool

    init(label: String, icon: String, route: AppRoute, isChatNavigation: Bool = false) {
        self.label = label
        self.icon = icon
        self.route = route
        self.isChatNavigation = isChatNavigation
    }
}

/// Maps timeline events to navigation destinations for deep linking.
/// Used by context menus and tap actions on timeline rows to navigate
/// to the relevant detail view (agent, bead, proposal, etc.).
struct TimelineNavigationResolver {

    /// Returns all available navigation actions for a timeline event.
    /// Multiple actions are possible — e.g., "View Agent" + "Open Chat" + "View Bead".
    static func actions(for event: TimelineEvent) -> [TimelineAction] {
        var result: [TimelineAction] = []

        // Primary action based on event type
        switch event.eventType {
        case "message_sent":
            if !event.agentId.isEmpty {
                result.append(TimelineAction(
                    label: "Open Chat with \(formatName(event.agentId))",
                    icon: "bubble.left.fill",
                    route: .chat,
                    isChatNavigation: true
                ))
                result.append(TimelineAction(
                    label: "View Agent \(formatName(event.agentId))",
                    icon: "person.fill",
                    route: .agentDetailById(id: event.agentId)
                ))
            }

        case "status_change", "progress_report", "announcement":
            if !event.agentId.isEmpty {
                result.append(TimelineAction(
                    label: "View Agent \(formatName(event.agentId))",
                    icon: "person.fill",
                    route: .agentDetailById(id: event.agentId)
                ))
                result.append(TimelineAction(
                    label: "Open Chat with \(formatName(event.agentId))",
                    icon: "bubble.left.fill",
                    route: .chat,
                    isChatNavigation: true
                ))
            }

        case "bead_updated", "bead_closed":
            if let beadId = event.beadId, !beadId.isEmpty {
                result.append(TimelineAction(
                    label: "View Bead \(beadId)",
                    icon: "circle.grid.3x3",
                    route: .beadDetail(id: beadId)
                ))
            }
            if !event.agentId.isEmpty {
                result.append(TimelineAction(
                    label: "View Agent \(formatName(event.agentId))",
                    icon: "person.fill",
                    route: .agentDetailById(id: event.agentId)
                ))
            }

        case "proposal_completed":
            if let proposalId = event.detail?["proposalId"]?.stringValue, !proposalId.isEmpty {
                result.append(TimelineAction(
                    label: "View Proposal",
                    icon: "doc.text.fill",
                    route: .proposalDetail(id: proposalId)
                ))
            }

        case "coordinator_action":
            if let target = event.detail?["target"]?.stringValue, !target.isEmpty {
                result.append(TimelineAction(
                    label: "View Agent \(formatName(target))",
                    icon: "person.fill",
                    route: .agentDetailById(id: target)
                ))
                result.append(TimelineAction(
                    label: "Open Chat with \(formatName(target))",
                    icon: "bubble.left.fill",
                    route: .chat,
                    isChatNavigation: true
                ))
            }

        default:
            break
        }

        // Secondary: any event with a beadId gets a "View Bead" option (if not already added)
        if let beadId = event.beadId, !beadId.isEmpty,
           !result.contains(where: { if case .beadDetail = $0.route { return true }; return false }) {
            result.append(TimelineAction(
                label: "View Bead \(beadId)",
                icon: "circle.grid.3x3",
                route: .beadDetail(id: beadId)
            ))
        }

        return result
    }

    /// Legacy single-route resolution (used by bead link tap).
    static func resolve(_ event: TimelineEvent) -> AppRoute? {
        actions(for: event).first?.route
    }

    /// Legacy label (used by older callsites).
    static func actionLabel(_ event: TimelineEvent) -> String? {
        actions(for: event).first?.label
    }

    /// Legacy icon (used by older callsites).
    static func actionIcon(_ event: TimelineEvent) -> String? {
        actions(for: event).first?.icon
    }

    private static func formatName(_ agentId: String) -> String {
        let components = agentId.split(separator: "/")
        return String(components.last ?? Substring(agentId)).uppercased()
    }
}
