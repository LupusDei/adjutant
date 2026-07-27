import XCTest
@testable import AdjutantUI

/// Unit tests for the PURE Mission Control project-selection state (adj-209.3.1).
///
/// No SwiftUI, no networking — a deterministic model over a known "available"
/// universe plus a UserDefaults codec, so the selector UI (adj-209.3.2) and the
/// ViewModel (adj-209.2.3) consume verified behavior rather than inlining it.
///
/// Design invariant under test: `.all` and `.subset(<full available set>)` are the
/// SAME visible state, so the model canonicalizes to `.all`. This keeps a
/// newly-appeared project VISIBLE by default instead of being silently hidden by a
/// stale allowlist, and lets the ViewModel send NO `projectIds` filter for "all".
final class MissionControlSelectionTests: XCTestCase {

    private let universe = ["adjutant", "bloomfolio", "runway"]

    // MARK: - Defaults

    func testDefaultIsAll() {
        XCTAssertEqual(MissionControlSelection.default, .all)
    }

    func testAllSelectsEveryAvailableId() {
        let sel = MissionControlSelection.all
        for id in universe {
            XCTAssertTrue(sel.isSelected(id), "\(id) should be selected under .all")
        }
        XCTAssertEqual(sel.selectedIds(available: universe), Set(universe))
    }

    // MARK: - selectAll / deselectAll

    func testSelectAllCollapsesToAll() {
        var sel = MissionControlSelection.subset(["adjutant"])
        sel.selectAll()
        XCTAssertEqual(sel, .all)
        XCTAssertEqual(sel.selectedIds(available: universe), Set(universe))
    }

    func testDeselectAllSelectsNothing() {
        var sel = MissionControlSelection.all
        sel.deselectAll()
        XCTAssertEqual(sel, .subset([]))
        XCTAssertTrue(sel.selectedIds(available: universe).isEmpty)
        for id in universe { XCTAssertFalse(sel.isSelected(id)) }
    }

    // MARK: - toggle (individual transitions)

    func testToggleFromAllDeselectsSingleAndKeepsRest() {
        var sel = MissionControlSelection.all
        sel.toggle("bloomfolio", available: universe)
        XCTAssertFalse(sel.isSelected("bloomfolio"))
        XCTAssertTrue(sel.isSelected("adjutant"))
        XCTAssertTrue(sel.isSelected("runway"))
        XCTAssertEqual(sel, .subset(["adjutant", "runway"]))
    }

    func testToggleReAddingLastMissingCollapsesBackToAll() {
        var sel = MissionControlSelection.subset(["adjutant", "runway"])
        sel.toggle("bloomfolio", available: universe)
        XCTAssertEqual(sel, .all, "Re-selecting the final missing project canonicalizes to .all so future projects stay visible")
    }

    func testToggleOffThenOnRoundTrips() {
        var sel = MissionControlSelection.all
        sel.toggle("runway", available: universe)   // .all -> subset(all - runway)
        XCTAssertFalse(sel.isSelected("runway"))
        sel.toggle("runway", available: universe)   // back to full -> .all
        XCTAssertEqual(sel, .all)
    }

    func testToggleFromEmptyAddsOne() {
        var sel = MissionControlSelection.subset([])
        sel.toggle("runway", available: universe)
        XCTAssertEqual(sel, .subset(["runway"]))
        XCTAssertTrue(sel.isSelected("runway"))
    }

    // MARK: - projectIds (server filter derivation)

    func testProjectIdsIsNilForAll() {
        XCTAssertNil(MissionControlSelection.all.projectIds(available: universe),
                     "`.all` sends NO server filter (fetch everything)")
    }

    func testProjectIdsIsSortedSubset() {
        let sel = MissionControlSelection.subset(["runway", "adjutant"])
        XCTAssertEqual(sel.projectIds(available: universe), ["adjutant", "runway"],
                       "Explicit subset yields a deterministic sorted allowlist")
    }

    func testProjectIdsNilWhenSubsetCoversWholeUniverse() {
        let sel = MissionControlSelection.subset(Set(universe))
        XCTAssertNil(sel.projectIds(available: universe),
                     "A subset equal to the whole universe == all → no filter")
    }

    func testProjectIdsEmptyArrayWhenNothingSelected() {
        let sel = MissionControlSelection.subset([])
        XCTAssertEqual(sel.projectIds(available: universe), [],
                       "Deselect-all yields an empty allowlist (show nothing), NOT nil (show all)")
    }

    func testSelectedIdsDropsStaleIdsNotInUniverse() {
        // A persisted id for a project that has since disappeared must not leak through.
        let sel = MissionControlSelection.subset(["adjutant", "ghost-project"])
        XCTAssertEqual(sel.selectedIds(available: universe), ["adjutant"])
        XCTAssertEqual(sel.projectIds(available: universe), ["adjutant"])
    }

    func testProjectIdsNilForEmptyUniverse() {
        // No projects known yet — never fabricate a filter.
        XCTAssertNil(MissionControlSelection.all.projectIds(available: []))
        XCTAssertEqual(MissionControlSelection.subset(["x"]).projectIds(available: []), [])
    }

    // MARK: - UserDefaults persistence round-trip

    private func makeDefaults(_ fn: String = #function) -> UserDefaults {
        let suite = "mc-selection-tests-\(fn)-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: suite)!
        d.removePersistentDomain(forName: suite)
        return d
    }

    func testPersistenceRoundTripsSubset() {
        let d = makeDefaults()
        let original = MissionControlSelection.subset(["runway", "adjutant"])
        MissionControlSelectionStore.save(original, to: d)
        XCTAssertEqual(MissionControlSelectionStore.load(from: d), original)
    }

    func testPersistenceRoundTripsAll() {
        let d = makeDefaults()
        MissionControlSelectionStore.save(.all, to: d)
        XCTAssertEqual(MissionControlSelectionStore.load(from: d), .all)
    }

    func testPersistenceRoundTripsEmptySubset() {
        let d = makeDefaults()
        MissionControlSelectionStore.save(.subset([]), to: d)
        XCTAssertEqual(MissionControlSelectionStore.load(from: d), .subset([]),
                       "Deselect-all must persist distinctly from .all (empty != absent)")
    }

    func testLoadUnsetDefaultsToAll() {
        let d = makeDefaults()
        XCTAssertEqual(MissionControlSelectionStore.load(from: d), .all,
                       "First launch (nothing persisted) shows all projects")
    }

    func testSavingAllClearsAnyPriorSubset() {
        let d = makeDefaults()
        MissionControlSelectionStore.save(.subset(["adjutant"]), to: d)
        MissionControlSelectionStore.save(.all, to: d)
        XCTAssertEqual(MissionControlSelectionStore.load(from: d), .all,
                       "Persisting .all must not leave a stale subset behind")
    }
}
