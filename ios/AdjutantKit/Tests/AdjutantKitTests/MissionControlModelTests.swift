import XCTest
@testable import AdjutantKit

/// Tests for the Mission Control rollup Codable models (epic adj-208, US2 / adj-208.2.1).
///
/// Shapes mirror the US1 endpoint contract for `GET /api/overview/projects`:
///
///   ApiResponse<{
///     projects: [{
///       projectId, name,
///       activeEpic: { id, title, completionPercent, closedChildren, totalChildren } | null,
///       epicsRemaining, openBeadsRemaining,
///       agents: [{ id, status }],
///       status: 'on_track' | 'needs_input' | 'blocked'
///     }],
///     totals: {
///       projects, agentsActive, epicsRemaining, openBeadsRemaining,
///       blocked, needsInput, portfolioCompletionPercent
///     }
///   }>
///
/// The shared `APIClient` decoder is a plain `JSONDecoder()` (no key strategy), so the
/// backend emits camelCase keys directly — these tests lock that. Models are
/// envelope-aware: they decode from the `data` payload of `ApiResponse<T>`.
final class MissionControlModelTests: XCTestCase {

    // A realistic multi-project payload. Project "beta" has activeEpic: null (no
    // in-progress epic) and zero agents — the edge case the map must render.
    private static let sampleDataJSON = """
    {
      "projects": [
        {
          "projectId": "0e578d15-1111-2222-3333-444455556666",
          "name": "adjutant",
          "activeEpic": {
            "id": "adj-208",
            "title": "Mission Control — iOS-first coordination map",
            "completionPercent": 42,
            "closedChildren": 5,
            "totalChildren": 12
          },
          "epicsRemaining": 3,
          "openBeadsRemaining": 27,
          "agents": [
            { "id": "engineer-ios-data", "status": "working" },
            { "id": "engineer-backend", "status": "idle" }
          ],
          "status": "on_track"
        },
        {
          "projectId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          "name": "beta",
          "activeEpic": null,
          "epicsRemaining": 0,
          "openBeadsRemaining": 4,
          "agents": [],
          "status": "blocked"
        }
      ],
      "totals": {
        "projects": 2,
        "agentsActive": 1,
        "epicsRemaining": 3,
        "openBeadsRemaining": 31,
        "blocked": 1,
        "needsInput": 0,
        "portfolioCompletionPercent": 21
      }
    }
    """

    private func decodeSample() throws -> OverviewProjectsResponse {
        let data = Self.sampleDataJSON.data(using: .utf8)!
        return try JSONDecoder().decode(OverviewProjectsResponse.self, from: data)
    }

    // MARK: - Top-level response

    func testDecodesProjectsAndTotals() throws {
        let response = try decodeSample()
        XCTAssertEqual(response.projects.count, 2)
        XCTAssertEqual(response.totals.projects, 2)
    }

    // MARK: - ProjectStreamRollup (with activeEpic)

    func testDecodesProjectWithActiveEpic() throws {
        let response = try decodeSample()
        let adjutant = response.projects[0]
        XCTAssertEqual(adjutant.projectId, "0e578d15-1111-2222-3333-444455556666")
        XCTAssertEqual(adjutant.name, "adjutant")
        XCTAssertEqual(adjutant.epicsRemaining, 3)
        XCTAssertEqual(adjutant.openBeadsRemaining, 27)
        XCTAssertEqual(adjutant.agents.count, 2)
        XCTAssertEqual(adjutant.status, "on_track")

        let epic = try XCTUnwrap(adjutant.activeEpic)
        XCTAssertEqual(epic.id, "adj-208")
        XCTAssertEqual(epic.title, "Mission Control — iOS-first coordination map")
        XCTAssertEqual(epic.completionPercent, 42, accuracy: 0.0001,
                       "completionPercent is an integer 0–100 (backend Math.round(fraction*100))")
        XCTAssertEqual(epic.closedChildren, 5)
        XCTAssertEqual(epic.totalChildren, 12)
    }

    // MARK: - ProjectStreamRollup (activeEpic == null — edge case)

    func testDecodesProjectWithNullActiveEpic() throws {
        let response = try decodeSample()
        let beta = response.projects[1]
        XCTAssertEqual(beta.name, "beta")
        XCTAssertNil(beta.activeEpic, "activeEpic:null must decode to nil, not throw")
        XCTAssertEqual(beta.epicsRemaining, 0)
        XCTAssertEqual(beta.openBeadsRemaining, 4)
        XCTAssertTrue(beta.agents.isEmpty, "empty agents array must decode to []")
        XCTAssertEqual(beta.status, "blocked")
    }

    // MARK: - ProjectAgent

    func testDecodesAgents() throws {
        let response = try decodeSample()
        let agents = response.projects[0].agents
        XCTAssertEqual(agents[0].id, "engineer-ios-data")
        XCTAssertEqual(agents[0].status, "working")
        XCTAssertEqual(agents[1].id, "engineer-backend")
        XCTAssertEqual(agents[1].status, "idle")
    }

    func testProjectAgentIsIdentifiableById() throws {
        let response = try decodeSample()
        let agent = response.projects[0].agents[0]
        XCTAssertEqual(agent.id, "engineer-ios-data")
    }

    // MARK: - Status kind (typed, defensive)

    func testStatusKindMapsKnownValues() throws {
        let response = try decodeSample()
        XCTAssertEqual(response.projects[0].statusKind, .onTrack)
        XCTAssertEqual(response.projects[1].statusKind, .blocked)
    }

    func testStatusKindFallsBackToUnknownForUnrecognizedRaw() throws {
        let json = """
        {
          "projectId": "p", "name": "n", "activeEpic": null,
          "epicsRemaining": 0, "openBeadsRemaining": 0, "agents": [],
          "status": "some_future_status"
        }
        """.data(using: .utf8)!
        let rollup = try JSONDecoder().decode(ProjectStreamRollup.self, from: json)
        XCTAssertEqual(rollup.status, "some_future_status", "raw string preserved")
        XCTAssertEqual(rollup.statusKind, .unknown, "unknown raw maps to .unknown, never throws")
    }

    func testStatusKindMapsNeedsInput() throws {
        let json = """
        {
          "projectId": "p", "name": "n", "activeEpic": null,
          "epicsRemaining": 0, "openBeadsRemaining": 0, "agents": [],
          "status": "needs_input"
        }
        """.data(using: .utf8)!
        let rollup = try JSONDecoder().decode(ProjectStreamRollup.self, from: json)
        XCTAssertEqual(rollup.statusKind, .needsInput)
    }

    // MARK: - PortfolioTotals

    func testDecodesPortfolioTotals() throws {
        let totals = try decodeSample().totals
        XCTAssertEqual(totals.projects, 2)
        XCTAssertEqual(totals.agentsActive, 1)
        XCTAssertEqual(totals.epicsRemaining, 3)
        XCTAssertEqual(totals.openBeadsRemaining, 31)
        XCTAssertEqual(totals.blocked, 1)
        XCTAssertEqual(totals.needsInput, 0)
        XCTAssertEqual(totals.portfolioCompletionPercent, 21, accuracy: 0.0001,
                       "portfolioCompletionPercent is an integer 0–100")
    }

    // MARK: - Envelope-aware decode (ApiResponse<OverviewProjectsResponse>)

    func testDecodesInsideApiResponseEnvelope() throws {
        let enveloped = """
        {
          "success": true,
          "data": \(Self.sampleDataJSON),
          "timestamp": "2026-07-22T10:00:00.000Z"
        }
        """.data(using: .utf8)!

        let envelope = try JSONDecoder().decode(ApiResponse<OverviewProjectsResponse>.self, from: enveloped)
        XCTAssertTrue(envelope.success)
        let payload = try XCTUnwrap(envelope.data)
        XCTAssertEqual(payload.projects.count, 2)
        XCTAssertEqual(payload.totals.agentsActive, 1)
    }

    // MARK: - Identifiable

    func testProjectRollupIsIdentifiableByProjectId() throws {
        let response = try decodeSample()
        XCTAssertEqual(response.projects[0].id, response.projects[0].projectId)
    }

    // MARK: - Equatable

    func testResponseIsEquatable() throws {
        let a = try decodeSample()
        let b = try decodeSample()
        XCTAssertEqual(a, b)
    }
}
