import Foundation

/// PURE, view-agnostic project-selection state for the Mission Control map (adj-209.3.1).
///
/// Models the user's project filter as **either** "all projects" or "an explicit subset",
/// which is more than a stylistic choice: it fixes a real bug in a naive allowlist. If
/// selection were only a `Set<String>`, "select all" would freeze the set to *today's*
/// projects and a project that appears tomorrow would be silently hidden. By keeping `.all`
/// distinct from `.subset(...)`:
///
/// - a newly-appeared project is **visible by default** (covered by `.all`), and
/// - the ViewModel (adj-209.2.3) can send **no** `projectIds` filter for `.all` (fetch
///   everything server-side) versus an explicit allowlist for a subset.
///
/// Canonical invariant: a `.subset` that equals the whole available universe is the SAME
/// visible state as `.all`, so `toggle` collapses it back to `.all`. There is exactly one
/// representation of every visible state, which keeps persistence and equality unambiguous.
///
/// Deliberately free of SwiftUI/UserDefaults so it is trivially unit-tested; persistence is
/// a separate concern in ``MissionControlSelectionStore``.
enum MissionControlSelection: Equatable {
    /// Every project — including any that appear in the future — is selected.
    case all
    /// Only the listed project ids are selected. May be empty (show nothing).
    case subset(Set<String>)

    /// First-launch default: show the whole portfolio.
    static let `default`: MissionControlSelection = .all

    /// Whether a specific project id is currently selected.
    func isSelected(_ id: String) -> Bool {
        switch self {
        case .all:              return true
        case .subset(let ids):  return ids.contains(id)
        }
    }

    /// The concrete set of selected ids, resolved against the currently-available universe.
    /// Stale ids (persisted for a project that has since disappeared) are dropped so they
    /// never leak into a request or a checkbox.
    func selectedIds(available: [String]) -> Set<String> {
        switch self {
        case .all:              return Set(available)
        case .subset(let ids):  return ids.intersection(available)
        }
    }

    /// The server-side `projectIds` filter this selection implies.
    ///
    /// - `.all` → `nil` (send no filter; the backend returns every project).
    /// - a subset that (after dropping stale ids) covers the whole non-empty universe → `nil`
    ///   (it is equivalent to "all").
    /// - otherwise → the explicit, deterministically **sorted** allowlist (may be empty →
    ///   "show nothing", which is distinct from `nil` → "show all").
    func projectIds(available: [String]) -> [String]? {
        switch self {
        case .all:
            return nil
        case .subset(let ids):
            let resolved = ids.intersection(available)
            if !available.isEmpty && resolved.count == available.count { return nil }
            return resolved.sorted()
        }
    }

    /// Select every project (now and future).
    mutating func selectAll() { self = .all }

    /// Select no projects.
    mutating func deselectAll() { self = .subset([]) }

    /// Flip a single project's membership against the available universe, then canonicalize:
    /// if the result covers the whole universe, collapse to `.all` so future projects stay
    /// visible.
    mutating func toggle(_ id: String, available: [String]) {
        var ids = selectedIds(available: available)
        if ids.contains(id) {
            ids.remove(id)
        } else {
            ids.insert(id)
        }
        if !available.isEmpty && ids == Set(available) {
            self = .all
        } else {
            self = .subset(ids)
        }
    }
}

/// UserDefaults codec for ``MissionControlSelection`` (adj-209.3.1).
///
/// Persistence must preserve the `.all` vs `.subset([])` distinction — "show all" and "show
/// nothing" are opposite states. `.all` is stored as the **absence** of the key so that a
/// fresh install (also absent) defaults to `.all`; a subset (including the empty subset) is
/// stored as a sorted `[String]`. Absent ⇒ `.all`; present array ⇒ that subset.
enum MissionControlSelectionStore {
    /// Versioned key so a future schema change is a clean migration, not a silent mis-decode.
    static let defaultsKey = "missionControl.projectSelection.v1"

    static func load(
        from defaults: UserDefaults = .standard,
        key: String = defaultsKey
    ) -> MissionControlSelection {
        guard let stored = defaults.array(forKey: key) as? [String] else {
            return .all // absent (or wrong type) → default to the whole portfolio
        }
        return .subset(Set(stored))
    }

    static func save(
        _ selection: MissionControlSelection,
        to defaults: UserDefaults = .standard,
        key: String = defaultsKey
    ) {
        switch selection {
        case .all:
            defaults.removeObject(forKey: key) // absence == all → future-proof default
        case .subset(let ids):
            defaults.set(ids.sorted(), forKey: key)
        }
    }
}
