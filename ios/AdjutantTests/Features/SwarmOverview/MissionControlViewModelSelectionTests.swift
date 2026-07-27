import XCTest
import AdjutantKit
@testable import AdjutantUI

/// Tests for `MissionControlViewModel` project-selection + per-feature intensity wiring
/// (epic adj-209, US2 / adj-209.2.3):
///  - a **persisted** selected-project set (UserDefaults), default = all;
///  - the selection is sent as the `projectIds` filter on `refresh()`/poll;
///  - `visibleProjects` reflects the selection;
///  - `features(for:)` + per-project `activityLevel` are surfaced from the rollup.
///
/// Network is mocked via `MockURLProtocol`; persistence uses an isolated, ephemeral
/// `UserDefaults` suite per test so nothing leaks into `.standard`.
@MainActor
final class MissionControlViewModelSelectionTests: XCTestCase {

    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() async throws {
        suiteName = "mission-control-selection-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() async throws {
        MockURLProtocol.mockHandler = nil
        defaults.removePersistentDomain(forName: suiteName)
        defaults = nil
        suiteName = nil
    }

    // MARK: - Helpers

    private func makeMockAPIClient() -> APIClient {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockURLProtocol.self]
        let clientConfig = APIClientConfiguration(
            baseURL: URL(string: "http://test.local/api")!,
            retryPolicy: .none
        )
        return APIClient(configuration: clientConfig, urlSessionConfiguration: sessionConfig)
    }

    /// Builds a rollup envelope carrying explicit project ids, one feature node each,
    /// and a per-project `activityLevel`.
    private func rollupEnvelope(projectIds: [String]) -> [String: Any] {
        let projects: [[String: Any]] = projectIds.enumerated().map { idx, pid in
            [
                "projectId": pid,
                "name": "Project-\(pid)",
                "activeEpic": [
                    "id": "e-\(pid)", "title": "Epic \(pid)",
                    "completionPercent": 40, "closedChildren": 2, "totalChildren": 5
                ] as [String: Any],
                "epicsRemaining": 1,
                "openBeadsRemaining": 3,
                "agents": [["id": "a-\(pid)", "status": "working"] as [String: Any]],
                "status": "on_track",
                "activityLevel": 0.5 + Double(idx) * 0.1,
                "agentCount": 3 + idx,
                "features": [
                    [
                        "id": "f-\(pid)", "title": "Feature \(pid)",
                        "completionPercent": 50, "closedChildren": 1, "totalChildren": 2,
                        "agents": [["id": "a-\(pid)", "status": "working"] as [String: Any]],
                        "activityLevel": 0.7, "status": "on_track"
                    ] as [String: Any]
                ]
            ]
        }
        return [
            "projects": projects,
            "totals": [
                "projects": projectIds.count, "agentsActive": projectIds.count,
                "epicsRemaining": projectIds.count, "openBeadsRemaining": projectIds.count * 3,
                "blocked": 0, "needsInput": 0, "portfolioCompletionPercent": 40
            ] as [String: Any]
        ]
    }

    /// Installs a success mock and captures each request's URL for query assertions.
    private func installCapturingMock(projectIds: [String], capture: @escaping (URLRequest) -> Void) {
        let envelope: [String: Any] = [
            "success": true,
            "data": rollupEnvelope(projectIds: projectIds),
            "timestamp": "2026-07-27T00:00:00.000Z"
        ]
        MockURLProtocol.mockHandler = { request in
            capture(request)
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                           headerFields: ["Content-Type": "application/json"])!
            return (response, data)
        }
    }

    private func capturedProjectIds(from url: URL?) -> String? {
        guard let url,
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        return comps.queryItems?.first(where: { $0.name == "projectIds" })?.value
    }

    private func makeVM(apiClient: APIClient) -> MissionControlViewModel {
        MissionControlViewModel(apiClient: apiClient, defaults: defaults)
    }

    // MARK: - Default selection = all

    func testDefaultSelectionIsAll() {
        let vm = makeVM(apiClient: makeMockAPIClient())
        XCTAssertNil(vm.selectedProjectIds, "default (no persisted value) is nil == all projects")
        XCTAssertTrue(vm.isAllSelected)
        XCTAssertTrue(vm.isSelected("anything"), "with no explicit selection every project is selected")
    }

    func testDefaultRefreshSendsNoProjectIdsFilter() async {
        var captured: URL?
        installCapturingMock(projectIds: ["p1", "p2"]) { captured = $0.url }
        let vm = makeVM(apiClient: makeMockAPIClient())

        await vm.refresh()
        XCTAssertNil(capturedProjectIds(from: captured),
                     "default selection sends no projectIds param (server returns all)")
    }

    // MARK: - Persistence round-trip

    func testSetSelectionPersistsAndRoundTrips() {
        let vm = makeVM(apiClient: makeMockAPIClient())
        vm.setSelectedProjectIds(["p1", "p3"])
        XCTAssertEqual(vm.selectedProjectIds, ["p1", "p3"])

        // A brand-new VM reading the SAME defaults must recover the selection.
        let reloaded = makeVM(apiClient: makeMockAPIClient())
        XCTAssertEqual(reloaded.selectedProjectIds, ["p1", "p3"],
                       "selection persists across VM instances via UserDefaults")
    }

    func testDeselectAllPersistsEmptyDistinctFromAll() {
        let vm = makeVM(apiClient: makeMockAPIClient())
        vm.deselectAll()
        XCTAssertEqual(vm.selectedProjectIds, [], "deselect-all is an explicit empty set")
        XCTAssertFalse(vm.isAllSelected)

        let reloaded = makeVM(apiClient: makeMockAPIClient())
        XCTAssertEqual(reloaded.selectedProjectIds, [],
                       "an explicit empty selection round-trips as [] (NOT nil/all)")
    }

    func testSelectAllClearsPersistedSelection() {
        let vm = makeVM(apiClient: makeMockAPIClient())
        vm.setSelectedProjectIds(["p1"])
        vm.selectAll()
        XCTAssertNil(vm.selectedProjectIds, "select-all resets to the default all == nil")

        let reloaded = makeVM(apiClient: makeMockAPIClient())
        XCTAssertNil(reloaded.selectedProjectIds, "select-all clears the persisted value")
    }

    // MARK: - projectIds sent to client

    func testRefreshSendsExplicitSelectionAsProjectIds() async {
        var captured: URL?
        installCapturingMock(projectIds: ["p1", "p2", "p3"]) { captured = $0.url }
        let vm = makeVM(apiClient: makeMockAPIClient())

        vm.setSelectedProjectIds(["p1", "p3"])
        await vm.refresh()

        let sent = capturedProjectIds(from: captured)
        XCTAssertEqual(sent?.split(separator: ",").map(String.init).sorted(), ["p1", "p3"],
                       "refresh sends the persisted selection as the projectIds filter")
    }

    // MARK: - toggle

    func testTogglePersistsMembership() async {
        var captured: URL?
        installCapturingMock(projectIds: ["p1", "p2", "p3"]) { captured = $0.url }
        let vm = makeVM(apiClient: makeMockAPIClient())
        await vm.refresh() // establishes the known-project universe {p1,p2,p3}

        // From the default "all", toggling p2 OFF yields {p1,p3}.
        vm.toggleProject("p2")
        XCTAssertEqual(vm.selectedProjectIds, ["p1", "p3"])
        XCTAssertFalse(vm.isSelected("p2"))

        // Toggling p2 back ON restores the full universe → collapses to nil (all).
        vm.toggleProject("p2")
        XCTAssertNil(vm.selectedProjectIds, "re-selecting every project collapses to all == nil")

        let reloaded = makeVM(apiClient: makeMockAPIClient())
        XCTAssertNil(reloaded.selectedProjectIds, "toggle result persists")
    }

    // MARK: - visibleProjects reflects selection

    func testVisibleProjectsFilteredBySelection() async {
        installCapturingMock(projectIds: ["p1", "p2", "p3"]) { _ in }
        let vm = makeVM(apiClient: makeMockAPIClient())
        await vm.refresh()
        XCTAssertEqual(vm.visibleProjects.count, 3, "default all shows every project")

        vm.setSelectedProjectIds(["p2"])
        XCTAssertEqual(vm.visibleProjects.map(\.projectId), ["p2"],
                       "visibleProjects is filtered to the selection")

        vm.deselectAll()
        XCTAssertTrue(vm.visibleProjects.isEmpty, "deselect-all shows no projects")
    }

    // MARK: - features / activity surfaced

    func testFeaturesAndActivitySurfaced() async {
        installCapturingMock(projectIds: ["p1", "p2"]) { _ in }
        let vm = makeVM(apiClient: makeMockAPIClient())
        await vm.refresh()

        let p1 = try? XCTUnwrap(vm.visibleProjects.first { $0.projectId == "p1" })
        XCTAssertEqual(p1??.activityLevel ?? -1, 0.5, accuracy: 0.0001,
                       "project activityLevel is surfaced from the rollup")

        let features = vm.features(for: "p1")
        XCTAssertEqual(features.count, 1)
        XCTAssertEqual(features.first?.id, "f-p1")
        XCTAssertEqual(features.first?.activityLevel ?? -1, 0.7, accuracy: 0.0001,
                       "per-feature activityLevel is surfaced")
    }

    func testFeaturesForUnknownProjectIsEmpty() async {
        installCapturingMock(projectIds: ["p1"]) { _ in }
        let vm = makeVM(apiClient: makeMockAPIClient())
        await vm.refresh()
        XCTAssertTrue(vm.features(for: "nope").isEmpty,
                      "features(for:) returns [] for an unknown/absent project")
    }
}
