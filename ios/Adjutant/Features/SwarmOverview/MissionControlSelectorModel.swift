import Foundation

/// PURE presenter for the Mission Control project selector (adj-209.3.2).
///
/// Turns the two inputs the selector needs — the FULL list of available projects and the current
/// selection — into render-ready output: the checkbox rows, the header button states
/// (Select all / Deselect all), and a compact summary. No SwiftUI, so the selector is a thin
/// shell over verified logic.
///
/// Selection is modeled exactly as the ViewModel stores it (`selectedProjectIds: Set<String>?`,
/// adj-209.2.3): **`nil` means all projects** (no explicit filter) and a `Set` — possibly empty —
/// is an explicit selection. Keeping ONE selection representation (the VM's) avoids a second,
/// divergent source of truth.
///
/// The project list here is the UNFILTERED universe (from a cheap `GET /api/projects`), NOT the
/// server-filtered map rollup: with a server-side `projectIds` filter the rollup only contains
/// *selected* projects, so deriving the selector from it would make a deselected project
/// impossible to re-enable (adj-209.3.2.1).
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
    /// `nil` == all projects selected; a `Set` (possibly empty) is an explicit selection.
    let selectedIds: Set<String>?

    init(projects: [Project], selectedIds: Set<String>?) {
        self.projects = projects
        self.selectedIds = selectedIds
    }

    /// Whether a specific project is selected. With no explicit selection (`nil` == all),
    /// every project reads as selected.
    func isSelected(_ id: String) -> Bool {
        selectedIds?.contains(id) ?? true
    }

    /// One row per available project, in order, flagged by the current selection.
    var rows: [Row] {
        projects.map { Row(id: $0.id, name: $0.name, isSelected: isSelected($0.id)) }
    }

    /// Number of AVAILABLE projects currently selected (ids not in the universe don't count).
    var selectedCount: Int {
        guard let ids = selectedIds else { return projects.count } // nil == all
        return projects.reduce(0) { $0 + (ids.contains($1.id) ? 1 : 0) }
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

    /// A compact status line for the selector's trigger control.
    var summary: String {
        if projects.isEmpty { return "NO PROJECTS" }
        if isAllSelected { return "ALL PROJECTS" }
        if isNoneSelected { return "NONE" }
        return "\(selectedCount) / \(projects.count)"
    }
}
