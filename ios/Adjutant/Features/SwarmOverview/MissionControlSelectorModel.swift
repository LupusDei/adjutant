import Foundation

/// PURE presenter for the Mission Control project selector (adj-209.3.2).
///
/// Turns the two inputs the selector needs — the currently-available projects and the persisted
/// ``MissionControlSelection`` — into render-ready output: the checkbox rows, the header button
/// states (Select all / Deselect all), a compact summary, and the derived server `projectIds`.
/// No SwiftUI, so the whole selector is a thin shell over verified logic and the
/// selection → `projectIds` derivation stays owned by ``MissionControlSelection`` (adj-209.3.1),
/// which the ViewModel (adj-209.2.3) consumes as the single source of truth.
struct MissionControlSelectorModel: Equatable {

    /// A selectable project — id (canonical) + display name only.
    struct Project: Equatable, Identifiable {
        let id: String
        let name: String
        init(id: String, name: String) {
            self.id = id
            self.name = name
        }
    }

    /// One checkbox row in the selector.
    struct Row: Equatable, Identifiable {
        let id: String
        let name: String
        let isSelected: Bool
    }

    let projects: [Project]
    let selection: MissionControlSelection

    init(projects: [Project], selection: MissionControlSelection) {
        self.projects = projects
        self.selection = selection
    }

    /// The universe of available project ids, in display order.
    private var available: [String] { projects.map(\.id) }

    /// One row per available project, in order, flagged by the current selection.
    var rows: [Row] {
        projects.map { Row(id: $0.id, name: $0.name, isSelected: selection.isSelected($0.id)) }
    }

    /// Number of AVAILABLE projects currently selected (stale ids are not counted).
    var selectedCount: Int {
        selection.selectedIds(available: available).count
    }

    /// True when every available project is selected — drives the "Select all" active state.
    /// False when there are no projects (there is nothing to select).
    var isAllSelected: Bool {
        !projects.isEmpty && selectedCount == projects.count
    }

    /// True when no available project is selected — drives the "Deselect all" active state.
    var isNoneSelected: Bool {
        selectedCount == 0
    }

    /// The server-side `projectIds` filter for the current selection (`nil` == fetch all).
    var projectIds: [String]? {
        selection.projectIds(available: available)
    }

    /// A compact status line for the selector's trigger control.
    var summary: String {
        if projects.isEmpty { return "NO PROJECTS" }
        if isAllSelected { return "ALL PROJECTS" }
        if isNoneSelected { return "NONE" }
        return "\(selectedCount) / \(projects.count)"
    }
}
