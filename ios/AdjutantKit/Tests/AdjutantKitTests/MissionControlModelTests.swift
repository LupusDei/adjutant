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

// MARK: - Per-feature intensity (epic adj-209, US2 / adj-209.2.1)
//
// US1 extends each project with:
//   features: [{ id, title, completionPercent, closedChildren, totalChildren,
//               agents: [{ id, status }], activityLevel (Double 0..1), status }]
//   activityLevel (Double 0..1)  — project-level composite intensity
//   agentCount (Int)             — uncapped active-agent count
//
// The models are ADDITIVE and tolerant: old adj-208 payloads (no features /
// activityLevel / agentCount) must still decode — `features` defaults to `[]`,
// `activityLevel` to `0`, and `agentCount` falls back to `agents.count`. Unknown
// keys are ignored. These tests lock that contract against REAL JSON shapes.
extension MissionControlModelTests {

    // A project carrying two feature nodes with differing intensity, project-level
    // activityLevel + agentCount, plus one unknown key the decoder must ignore.
    fileprivate static let featureDataJSON = """
    {
      "projects": [
        {
          "projectId": "0e578d15-1111-2222-3333-444455556666",
          "name": "adjutant",
          "activeEpic": {
            "id": "adj-209",
            "title": "Mission Control — selection + intensity",
            "completionPercent": 30,
            "closedChildren": 3,
            "totalChildren": 10
          },
          "epicsRemaining": 2,
          "openBeadsRemaining": 19,
          "agents": [
            { "id": "eng209-ios-data", "status": "working" },
            { "id": "eng209-backend", "status": "working" }
          ],
          "status": "on_track",
          "activityLevel": 0.82,
          "agentCount": 7,
          "features": [
            {
              "id": "adj-209.2",
              "title": "iOS data layer",
              "completionPercent": 66,
              "closedChildren": 2,
              "totalChildren": 3,
              "agents": [
                { "id": "eng209-ios-data", "status": "working" }
              ],
              "activityLevel": 0.9,
              "status": "on_track"
            },
            {
              "id": "adj-209.4",
              "title": "Map intensity",
              "completionPercent": 0,
              "closedChildren": 0,
              "totalChildren": 3,
              "agents": [],
              "activityLevel": 0.1,
              "status": "needs_input"
            }
          ],
          "futureUnknownKey": "ignored"
        }
      ],
      "totals": {
        "projects": 1,
        "agentsActive": 2,
        "epicsRemaining": 2,
        "openBeadsRemaining": 19,
        "blocked": 0,
        "needsInput": 0,
        "portfolioCompletionPercent": 30
      }
    }
    """

    fileprivate func decodeFeatureSample() throws -> OverviewProjectsResponse {
        let data = Self.featureDataJSON.data(using: .utf8)!
        return try JSONDecoder().decode(OverviewProjectsResponse.self, from: data)
    }

    // MARK: - Project-level new fields

    func testDecodesProjectActivityLevelAndAgentCount() throws {
        let project = try decodeFeatureSample().projects[0]
        XCTAssertEqual(project.activityLevel, 0.82, accuracy: 0.0001,
                       "project activityLevel is a composite 0..1 Double")
        XCTAssertEqual(project.agentCount, 7, "agentCount is the uncapped active-agent count")
    }

    // MARK: - degraded flag (adj-209 US1 — cold-dolt partial-data indicator)

    func testDecodesDegradedFlag() throws {
        let json = """
        {
          "projectId": "p", "name": "n", "activeEpic": null,
          "epicsRemaining": 0, "openBeadsRemaining": 0, "agents": [],
          "status": "on_track", "degraded": true
        }
        """.data(using: .utf8)!
        let rollup = try JSONDecoder().decode(ProjectStreamRollup.self, from: json)
        XCTAssertTrue(rollup.degraded, "degraded:true decodes to true")
    }

    func testMissingDegradedDefaultsFalse() throws {
        // The original adj-208 sample has no `degraded` key.
        let adjutant = try decodeSample().projects[0]
        XCTAssertFalse(adjutant.degraded, "missing degraded defaults to false (authoritative data)")
    }

    // MARK: - features[]

    func testDecodesFeaturesArray() throws {
        let project = try decodeFeatureSample().projects[0]
        XCTAssertEqual(project.features.count, 2, "both in-progress feature nodes decode")
    }

    func testDecodesFeatureRollupFields() throws {
        let feature = try decodeFeatureSample().projects[0].features[0]
        XCTAssertEqual(feature.id, "adj-209.2")
        XCTAssertEqual(feature.title, "iOS data layer")
        XCTAssertEqual(feature.completionPercent, 66, accuracy: 0.0001,
                       "completionPercent is an integer 0–100")
        XCTAssertEqual(feature.closedChildren, 2)
        XCTAssertEqual(feature.totalChildren, 3)
        XCTAssertEqual(feature.activityLevel, 0.9, accuracy: 0.0001,
                       "feature activityLevel is a composite 0..1 Double")
        XCTAssertEqual(feature.status, "on_track")
    }

    func testDecodesFeatureAgents() throws {
        let feature = try decodeFeatureSample().projects[0].features[0]
        XCTAssertEqual(feature.agents.count, 1)
        XCTAssertEqual(feature.agents[0].id, "eng209-ios-data")
        XCTAssertEqual(feature.agents[0].status, "working")
    }

    func testDecodesFeatureWithEmptyAgents() throws {
        let feature = try decodeFeatureSample().projects[0].features[1]
        XCTAssertEqual(feature.id, "adj-209.4")
        XCTAssertTrue(feature.agents.isEmpty, "empty agents array decodes to []")
        XCTAssertEqual(feature.completionPercent, 0, accuracy: 0.0001)
        XCTAssertEqual(feature.activityLevel, 0.1, accuracy: 0.0001)
    }

    func testFeatureRollupIsIdentifiableById() throws {
        let feature = try decodeFeatureSample().projects[0].features[0]
        XCTAssertEqual(feature.id, "adj-209.2", "FeatureRollup is Identifiable by its bead id")
    }

    func testFeatureStatusKindMapsKnownAndUnknown() throws {
        let features = try decodeFeatureSample().projects[0].features
        XCTAssertEqual(features[0].statusKind, .onTrack)
        XCTAssertEqual(features[1].statusKind, .needsInput)
    }

    func testFeatureStatusKindFallsBackToUnknown() throws {
        let json = """
        {
          "id": "f", "title": "t", "completionPercent": 0,
          "closedChildren": 0, "totalChildren": 0, "agents": [],
          "activityLevel": 0.5, "status": "some_future_status"
        }
        """.data(using: .utf8)!
        let feature = try JSONDecoder().decode(FeatureRollup.self, from: json)
        XCTAssertEqual(feature.status, "some_future_status", "raw status preserved")
        XCTAssertEqual(feature.statusKind, .unknown, "unknown raw maps to .unknown, never throws")
    }

    // MARK: - Backward compatibility (old adj-208 payload, no new fields)

    func testMissingFeaturesDefaultsToEmpty() throws {
        // Uses the ORIGINAL adj-208 sample (no features / activityLevel / agentCount).
        let response = try decodeSample()
        let adjutant = response.projects[0]
        XCTAssertTrue(adjutant.features.isEmpty,
                      "missing features[] decodes to [] — old payloads stay valid")
        XCTAssertEqual(adjutant.activityLevel, 0, accuracy: 0.0001,
                       "missing activityLevel defaults to 0")
    }

    func testMissingAgentCountFallsBackToAgentsCount() throws {
        // Old adjutant project has 2 agents and no explicit agentCount.
        let adjutant = try decodeSample().projects[0]
        XCTAssertEqual(adjutant.agentCount, adjutant.agents.count,
                       "missing agentCount falls back to agents.count (2)")
        XCTAssertEqual(adjutant.agentCount, 2)
    }

    // MARK: - Unknown keys are ignored (forward compatibility)

    func testUnknownKeysAreIgnored() throws {
        // featureDataJSON contains "futureUnknownKey" — decode must not throw.
        XCTAssertNoThrow(try decodeFeatureSample(),
                         "unknown keys in the payload must be tolerated")
    }

    // MARK: - Envelope-aware decode with features

    func testDecodesFeaturePayloadInsideApiResponseEnvelope() throws {
        let enveloped = """
        {
          "success": true,
          "data": \(Self.featureDataJSON),
          "timestamp": "2026-07-27T10:00:00.000Z"
        }
        """.data(using: .utf8)!
        let envelope = try JSONDecoder().decode(ApiResponse<OverviewProjectsResponse>.self, from: enveloped)
        let payload = try XCTUnwrap(envelope.data)
        XCTAssertEqual(payload.projects[0].features.count, 2)
        XCTAssertEqual(payload.projects[0].activityLevel, 0.82, accuracy: 0.0001)
    }

    // MARK: - Equatable (feature payload)

    func testFeaturePayloadIsEquatable() throws {
        let a = try decodeFeatureSample()
        let b = try decodeFeatureSample()
        XCTAssertEqual(a, b)
    }
}
