import Foundation

/// Segments for the Overview screen's top segmented control (adj-208.3.4): the existing
/// **Summary** dashboard vs. the **Mission Control** map.
///
/// The default is ``summary`` so the Overview screen is unchanged on first appearance
/// (spec US3) — Mission Control is opt-in. Extracted from the view so the default and the
/// case ordering are unit-testable without rendering.
enum MissionControlSegment: String, CaseIterable, Identifiable {
    case summary
    case missionControl

    var id: String { rawValue }

    /// Human-facing title for the `Picker` segment.
    var title: String {
        switch self {
        case .summary: return "Summary"
        case .missionControl: return "Mission Control"
        }
    }

    /// The segment shown on first appearance (existing Summary content, unchanged).
    static let defaultSegment: MissionControlSegment = .summary
}
