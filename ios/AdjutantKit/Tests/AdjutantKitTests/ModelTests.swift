import XCTest
@testable import AdjutantKit

final class ModelTests: XCTestCase {
    let decoder = JSONDecoder()

    // MARK: - Enum Tests

    func testMessagePriorityDecoding() throws {
        let json = "[0, 1, 2, 3, 4]"
        let priorities = try decoder.decode([MessagePriority].self, from: json.data(using: .utf8)!)

        XCTAssertEqual(priorities, [.urgent, .high, .normal, .low, .lowest])
    }

    func testMessageTypeDecoding() throws {
        let types = ["notification", "task", "scavenge", "reply"]

        for type in types {
            let json = "\"\(type)\""
            let decoded = try decoder.decode(MessageType.self, from: json.data(using: .utf8)!)
            XCTAssertEqual(decoded.rawValue, type)
        }
    }

    func testPowerStateDecoding() throws {
        let states = ["stopped", "starting", "running", "stopping"]

        for state in states {
            let json = "\"\(state)\""
            let decoded = try decoder.decode(PowerState.self, from: json.data(using: .utf8)!)
            XCTAssertEqual(decoded.rawValue, state)
        }
    }

    func testCrewMemberStatusDecoding() throws {
        let statuses = ["idle", "working", "blocked", "stuck", "offline"]

        for status in statuses {
            let json = "\"\(status)\""
            let decoded = try decoder.decode(CrewMemberStatus.self, from: json.data(using: .utf8)!)
            XCTAssertEqual(decoded.rawValue, status)
        }
    }

    func testAgentTypeDecoding() throws {
        let types = ["mayor", "deacon", "witness", "refinery", "crew", "polecat"]

        for type in types {
            let json = "\"\(type)\""
            let decoded = try decoder.decode(AgentType.self, from: json.data(using: .utf8)!)
            XCTAssertEqual(decoded.rawValue, type)
        }
    }

    // MARK: - Message Tests

    func testMessageDecoding() throws {
        let json = """
        {
            "id": "gb-53tj",
            "from": "mayor/",
            "to": "overseer",
            "subject": "Test subject",
            "body": "Test body",
            "timestamp": "2024-01-15T10:00:00.000Z",
            "read": false,
            "priority": 2,
            "type": "notification",
            "threadId": "thread-123",
            "pinned": false,
            "isInfrastructure": false
        }
        """

        let message = try decoder.decode(Message.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(message.id, "gb-53tj")
        XCTAssertEqual(message.from, "mayor/")
        XCTAssertEqual(message.to, "overseer")
        XCTAssertEqual(message.subject, "Test subject")
        XCTAssertEqual(message.body, "Test body")
        XCTAssertEqual(message.read, false)
        XCTAssertEqual(message.priority, .normal)
        XCTAssertEqual(message.type, .notification)
        XCTAssertEqual(message.threadId, "thread-123")
        XCTAssertEqual(message.pinned, false)
        XCTAssertEqual(message.isInfrastructure, false)
    }

    func testMessageWithOptionalFields() throws {
        let json = """
        {
            "id": "gb-reply",
            "from": "user",
            "to": "mayor/",
            "subject": "RE: Original",
            "body": "Reply body",
            "timestamp": "2024-01-15T11:00:00.000Z",
            "read": true,
            "priority": 1,
            "type": "reply",
            "threadId": "thread-123",
            "replyTo": "gb-original",
            "pinned": true,
            "cc": ["witness/", "refinery/"],
            "isInfrastructure": false
        }
        """

        let message = try decoder.decode(Message.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(message.replyTo, "gb-original")
        XCTAssertEqual(message.cc, ["witness/", "refinery/"])
        XCTAssertEqual(message.pinned, true)
        XCTAssertEqual(message.type, .reply)
    }

    func testMessageSenderName() throws {
        let json = """
        {
            "id": "test",
            "from": "mayor/",
            "to": "user",
            "subject": "",
            "body": "",
            "timestamp": "2024-01-15T10:00:00.000Z",
            "read": false,
            "priority": 2,
            "type": "notification",
            "threadId": "thread",
            "pinned": false,
            "isInfrastructure": false
        }
        """

        let message = try decoder.decode(Message.self, from: json.data(using: .utf8)!)
        XCTAssertEqual(message.senderName, "mayor")
    }

    // MARK: - CrewMember Tests

    func testCrewMemberDecoding() throws {
        let json = """
        {
            "id": "greenplace/Toast",
            "name": "Toast",
            "type": "polecat",
            "rig": "greenplace",
            "status": "working",
            "currentTask": "Building feature",
            "unreadMail": 5,
            "firstSubject": "Task assigned",
            "firstFrom": "mayor/",
            "branch": "polecat/feature-xyz"
        }
        """

        let member = try decoder.decode(CrewMember.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(member.id, "greenplace/Toast")
        XCTAssertEqual(member.name, "Toast")
        XCTAssertEqual(member.type, .polecat)
        XCTAssertEqual(member.rig, "greenplace")
        XCTAssertEqual(member.status, .working)
        XCTAssertEqual(member.currentTask, "Building feature")
        XCTAssertEqual(member.unreadMail, 5)
        XCTAssertEqual(member.branch, "polecat/feature-xyz")
    }

    func testCrewMemberWithNullRig() throws {
        let json = """
        {
            "id": "mayor/",
            "name": "mayor",
            "type": "mayor",
            "rig": null,
            "status": "working",
            "unreadMail": 0
        }
        """

        let member = try decoder.decode(CrewMember.self, from: json.data(using: .utf8)!)

        XCTAssertNil(member.rig)
        XCTAssertEqual(member.type, .mayor)
    }

    // MARK: - GastownStatus Tests

    func testGastownStatusDecoding() throws {
        let json = """
        {
            "powerState": "running",
            "town": {
                "name": "gastown",
                "root": "/Users/test/gt"
            },
            "operator": {
                "name": "testuser",
                "email": "test@example.com",
                "unreadMail": 3
            },
            "infrastructure": {
                "mayor": {
                    "name": "mayor",
                    "running": true,
                    "unreadMail": 0
                },
                "deacon": {
                    "name": "deacon",
                    "running": true,
                    "unreadMail": 0
                },
                "daemon": {
                    "name": "daemon",
                    "running": true,
                    "unreadMail": 0
                }
            },
            "rigs": [],
            "fetchedAt": "2024-01-15T10:30:00.000Z"
        }
        """

        let status = try decoder.decode(GastownStatus.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(status.powerState, .running)
        XCTAssertEqual(status.town.name, "gastown")
        XCTAssertEqual(status.operator.name, "testuser")
        XCTAssertEqual(status.operator.unreadMail, 3)
        XCTAssertTrue(status.infrastructure.mayor.running)
        XCTAssertEqual(status.rigs.count, 0)
    }

    // MARK: - Convoy Tests

    func testConvoyDecoding() throws {
        let json = """
        {
            "id": "convoy-001",
            "title": "Feature Implementation",
            "status": "in_progress",
            "rig": "greenplace",
            "progress": {
                "completed": 3,
                "total": 5
            },
            "trackedIssues": [
                {
                    "id": "gb-1",
                    "title": "Task 1",
                    "status": "closed"
                },
                {
                    "id": "gb-2",
                    "title": "Task 2",
                    "status": "in_progress",
                    "assignee": "polecat-123",
                    "priority": 1
                }
            ]
        }
        """

        let convoy = try decoder.decode(Convoy.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(convoy.id, "convoy-001")
        XCTAssertEqual(convoy.title, "Feature Implementation")
        XCTAssertEqual(convoy.rig, "greenplace")
        XCTAssertEqual(convoy.progress.completed, 3)
        XCTAssertEqual(convoy.progress.total, 5)
        XCTAssertEqual(convoy.progress.percentage, 0.6)
        XCTAssertFalse(convoy.isComplete)
        XCTAssertEqual(convoy.trackedIssues.count, 2)
    }

    func testConvoyProgressPercentage() {
        let complete = ConvoyProgress(completed: 5, total: 5)
        XCTAssertEqual(complete.percentage, 1.0)

        let empty = ConvoyProgress(completed: 0, total: 0)
        XCTAssertEqual(empty.percentage, 0.0)

        let half = ConvoyProgress(completed: 1, total: 2)
        XCTAssertEqual(half.percentage, 0.5)
    }

    func testConvoyIsComplete() {
        // Complete convoy (all tasks done)
        let completeConvoy = Convoy(
            id: "c1", title: "Complete", status: "open", rig: nil,
            progress: ConvoyProgress(completed: 5, total: 5),
            trackedIssues: []
        )
        XCTAssertTrue(completeConvoy.isComplete)
        XCTAssertFalse(completeConvoy.hasNoTasks)

        // Incomplete convoy
        let incompleteConvoy = Convoy(
            id: "c2", title: "Incomplete", status: "open", rig: nil,
            progress: ConvoyProgress(completed: 3, total: 5),
            trackedIssues: []
        )
        XCTAssertFalse(incompleteConvoy.isComplete)
        XCTAssertFalse(incompleteConvoy.hasNoTasks)

        // Empty convoy (0/0) should NOT be considered complete
        let emptyConvoy = Convoy(
            id: "c3", title: "Empty", status: "open", rig: nil,
            progress: ConvoyProgress(completed: 0, total: 0),
            trackedIssues: []
        )
        XCTAssertFalse(emptyConvoy.isComplete, "Convoy with 0/0 tasks should not be complete")
        XCTAssertTrue(emptyConvoy.hasNoTasks, "Convoy with 0 total tasks should have hasNoTasks=true")
    }

    // MARK: - BeadSource Tests

    func testBeadSourceDecoding() throws {
        let json = """
        {
            "name": "my-project",
            "path": "/home/user/my-project",
            "hasBeads": true
        }
        """

        let source = try decoder.decode(BeadSource.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(source.name, "my-project")
        XCTAssertEqual(source.path, "/home/user/my-project")
        XCTAssertTrue(source.hasBeads)
        XCTAssertEqual(source.id, "my-project", "BeadSource id should equal name")
    }

    func testBeadSourceWithoutBeads() throws {
        let json = """
        {
            "name": "empty-project",
            "path": "/home/user/empty-project",
            "hasBeads": false
        }
        """

        let source = try decoder.decode(BeadSource.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(source.name, "empty-project")
        XCTAssertFalse(source.hasBeads)
    }

    func testBeadSourceEquality() {
        let source1 = BeadSource(name: "proj", path: "/a", hasBeads: true)
        let source2 = BeadSource(name: "proj", path: "/a", hasBeads: true)
        let source3 = BeadSource(name: "other", path: "/b", hasBeads: false)

        XCTAssertEqual(source1, source2, "Identical sources should be equal")
        XCTAssertNotEqual(source1, source3, "Different sources should not be equal")
    }

    func testBeadSourceIdentifiable() {
        let source = BeadSource(name: "test-project", path: "/test", hasBeads: true)
        XCTAssertEqual(source.id, source.name, "BeadSource id should be its name")
    }

    func testBeadSourceEncoding() throws {
        let source = BeadSource(name: "my-app", path: "/Users/dev/my-app", hasBeads: true)
        let data = try JSONEncoder().encode(source)
        let decoded = try decoder.decode(BeadSource.self, from: data)

        XCTAssertEqual(decoded.name, source.name)
        XCTAssertEqual(decoded.path, source.path)
        XCTAssertEqual(decoded.hasBeads, source.hasBeads)
    }

    // MARK: - BeadSourcesResponse Tests

    func testBeadSourcesResponseDecoding() throws {
        let json = """
        {
            "sources": [
                {
                    "name": "project-a",
                    "path": "/home/user/project-a",
                    "hasBeads": true
                },
                {
                    "name": "project-b",
                    "path": "/home/user/project-b",
                    "hasBeads": true
                },
                {
                    "name": "empty-dir",
                    "path": "/home/user/empty-dir",
                    "hasBeads": false
                }
            ],
            "mode": "standalone"
        }
        """

        let response = try decoder.decode(BeadSourcesResponse.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(response.sources.count, 3)
        XCTAssertEqual(response.mode, "standalone")
        XCTAssertEqual(response.sources[0].name, "project-a")
        XCTAssertTrue(response.sources[0].hasBeads)
        XCTAssertEqual(response.sources[2].name, "empty-dir")
        XCTAssertFalse(response.sources[2].hasBeads)
    }

    func testBeadSourcesResponseEmptySources() throws {
        let json = """
        {
            "sources": [],
            "mode": "gastown"
        }
        """

        let response = try decoder.decode(BeadSourcesResponse.self, from: json.data(using: .utf8)!)

        XCTAssertTrue(response.sources.isEmpty)
        XCTAssertEqual(response.mode, "gastown")
    }

    func testBeadSourcesResponseSwarmMode() throws {
        let json = """
        {
            "sources": [
                {
                    "name": "shared-project",
                    "path": "/workspace/shared",
                    "hasBeads": true
                }
            ],
            "mode": "swarm"
        }
        """

        let response = try decoder.decode(BeadSourcesResponse.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(response.mode, "swarm")
        XCTAssertEqual(response.sources.count, 1)
    }

    func testBeadSourcesResponseEquality() {
        let sources = [BeadSource(name: "proj", path: "/p", hasBeads: true)]
        let response1 = BeadSourcesResponse(sources: sources, mode: "standalone")
        let response2 = BeadSourcesResponse(sources: sources, mode: "standalone")
        let response3 = BeadSourcesResponse(sources: [], mode: "gastown")

        XCTAssertEqual(response1, response2)
        XCTAssertNotEqual(response1, response3)
    }

    func testBeadSourcesResponseEncoding() throws {
        let sources = [
            BeadSource(name: "app", path: "/app", hasBeads: true),
            BeadSource(name: "lib", path: "/lib", hasBeads: false)
        ]
        let response = BeadSourcesResponse(sources: sources, mode: "standalone")
        let data = try JSONEncoder().encode(response)
        let decoded = try decoder.decode(BeadSourcesResponse.self, from: data)

        XCTAssertEqual(decoded.sources.count, 2)
        XCTAssertEqual(decoded.mode, "standalone")
        XCTAssertEqual(decoded.sources[0].name, "app")
        XCTAssertEqual(decoded.sources[1].name, "lib")
    }

    // MARK: - BeadInfo Tests

    func testBeadInfoDecoding() throws {
        let json = """
        {
            "id": "gb-53tj",
            "title": "Implement login",
            "status": "in_progress",
            "priority": 1,
            "type": "feature",
            "assignee": "greenplace/polecat-abc",
            "rig": "greenplace",
            "source": "greenplace",
            "labels": ["frontend", "auth"],
            "createdAt": "2024-01-10T08:00:00.000Z",
            "updatedAt": "2024-01-15T09:30:00.000Z"
        }
        """

        let bead = try decoder.decode(BeadInfo.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(bead.id, "gb-53tj")
        XCTAssertEqual(bead.title, "Implement login")
        XCTAssertEqual(bead.status, "in_progress")
        XCTAssertEqual(bead.priority, 1)
        XCTAssertEqual(bead.priorityLevel, .high)
        XCTAssertEqual(bead.labels, ["frontend", "auth"])
        XCTAssertNotNil(bead.createdDate)
        XCTAssertNotNil(bead.updatedDate)
    }

    func testBeadInfoWithNullOptionals() throws {
        let json = """
        {
            "id": "gb-123",
            "title": "Unassigned task",
            "status": "open",
            "priority": 2,
            "type": "task",
            "assignee": null,
            "rig": null,
            "source": "my-project",
            "labels": [],
            "createdAt": "2024-01-10T08:00:00Z",
            "updatedAt": null
        }
        """

        let bead = try decoder.decode(BeadInfo.self, from: json.data(using: .utf8)!)

        XCTAssertNil(bead.assignee)
        XCTAssertNil(bead.rig)
        XCTAssertNil(bead.updatedAt)
        XCTAssertNil(bead.updatedDate)
        XCTAssertTrue(bead.labels.isEmpty)
        XCTAssertEqual(bead.source, "my-project")
    }

    func testBeadInfoSourceField() throws {
        // Test that source field correctly identifies bead origin
        let projectBead = try decoder.decode(BeadInfo.self, from: """
        {
            "id": "pb-1", "title": "Project bead", "status": "open", "priority": 2,
            "type": "task", "assignee": null, "rig": null,
            "source": "my-project", "labels": [],
            "createdAt": "2024-01-10T08:00:00Z", "updatedAt": null
        }
        """.data(using: .utf8)!)

        let rigBead = try decoder.decode(BeadInfo.self, from: """
        {
            "id": "rb-1", "title": "Rig bead", "status": "open", "priority": 2,
            "type": "task", "assignee": null, "rig": "adjutant",
            "source": "adjutant", "labels": [],
            "createdAt": "2024-01-10T08:00:00Z", "updatedAt": null
        }
        """.data(using: .utf8)!)

        let townBead = try decoder.decode(BeadInfo.self, from: """
        {
            "id": "hq-1", "title": "Town bead", "status": "open", "priority": 2,
            "type": "task", "assignee": null, "rig": null,
            "source": "town", "labels": [],
            "createdAt": "2024-01-10T08:00:00Z", "updatedAt": null
        }
        """.data(using: .utf8)!)

        XCTAssertEqual(projectBead.source, "my-project")
        XCTAssertEqual(rigBead.source, "adjutant")
        XCTAssertEqual(townBead.source, "town")
    }

    func testBeadInfoDateParsing() throws {
        let json = """
        {
            "id": "gb-date", "title": "Date test", "status": "open", "priority": 2,
            "type": "task", "assignee": null, "rig": null,
            "source": "test", "labels": [],
            "createdAt": "2026-02-16T10:30:00Z",
            "updatedAt": "2026-02-16T14:45:00.123Z"
        }
        """

        let bead = try decoder.decode(BeadInfo.self, from: json.data(using: .utf8)!)

        XCTAssertNotNil(bead.createdDate, "Should parse ISO8601 date without fractional seconds")
        XCTAssertNotNil(bead.updatedDate, "Should parse ISO8601 date with fractional seconds")

        if let created = bead.createdDate, let updated = bead.updatedDate {
            XCTAssertTrue(updated > created, "Updated date should be after created date")
        }
    }

    func testBeadInfoEquality() {
        let bead1 = BeadInfo(
            id: "gb-1", title: "Test", status: "open", priority: 2,
            type: "task", assignee: nil, rig: nil, source: "proj",
            labels: ["a"], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil
        )
        let bead2 = BeadInfo(
            id: "gb-1", title: "Test", status: "open", priority: 2,
            type: "task", assignee: nil, rig: nil, source: "proj",
            labels: ["a"], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil
        )
        let bead3 = BeadInfo(
            id: "gb-2", title: "Different", status: "closed", priority: 0,
            type: "bug", assignee: "someone", rig: "rig1", source: "other",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil
        )

        XCTAssertEqual(bead1, bead2)
        XCTAssertNotEqual(bead1, bead3)
    }

    func testBeadInfoHashable() {
        let bead1 = BeadInfo(
            id: "gb-1", title: "Test", status: "open", priority: 2,
            type: "task", assignee: nil, rig: nil, source: "proj",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil
        )
        let bead2 = BeadInfo(
            id: "gb-2", title: "Other", status: "open", priority: 2,
            type: "task", assignee: nil, rig: nil, source: "proj",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil
        )

        var set = Set<BeadInfo>()
        set.insert(bead1)
        set.insert(bead2)
        set.insert(bead1) // Duplicate

        XCTAssertEqual(set.count, 2, "Set should deduplicate identical beads")
    }

    func testBeadInfoPriorityLevels() {
        let p0 = BeadInfo(id: "p0", title: "", status: "open", priority: 0,
            type: "t", assignee: nil, rig: nil, source: "s",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil)
        let p1 = BeadInfo(id: "p1", title: "", status: "open", priority: 1,
            type: "t", assignee: nil, rig: nil, source: "s",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil)
        let p2 = BeadInfo(id: "p2", title: "", status: "open", priority: 2,
            type: "t", assignee: nil, rig: nil, source: "s",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil)
        let p3 = BeadInfo(id: "p3", title: "", status: "open", priority: 3,
            type: "t", assignee: nil, rig: nil, source: "s",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil)
        let p4 = BeadInfo(id: "p4", title: "", status: "open", priority: 4,
            type: "t", assignee: nil, rig: nil, source: "s",
            labels: [], createdAt: "2024-01-10T08:00:00Z", updatedAt: nil)

        XCTAssertEqual(p0.priorityLevel, .urgent)
        XCTAssertEqual(p1.priorityLevel, .high)
        XCTAssertEqual(p2.priorityLevel, .normal)
        XCTAssertEqual(p3.priorityLevel, .low)
        XCTAssertEqual(p4.priorityLevel, .lowest)
    }

    // MARK: - Voice Tests

    func testNotificationResponseDecoding() throws {
        // Synthesized response
        let synthesizedJSON = """
        {
            "audioUrl": "/api/voice/audio/abc123.mp3",
            "duration": 5.5,
            "cached": true,
            "voiceId": "voice-1"
        }
        """

        let synthesized = try decoder.decode(NotificationResponse.self, from: synthesizedJSON.data(using: .utf8)!)
        guard case .synthesized(let response) = synthesized else {
            XCTFail("Expected synthesized response")
            return
        }
        XCTAssertEqual(response.audioUrl, "/api/voice/audio/abc123.mp3")
        XCTAssertEqual(response.duration, 5.5)
        XCTAssertTrue(response.cached)

        // Skipped response
        let skippedJSON = """
        {
            "skipped": true,
            "reason": "Notifications disabled"
        }
        """

        let skipped = try decoder.decode(NotificationResponse.self, from: skippedJSON.data(using: .utf8)!)
        guard case .skipped(let reason) = skipped else {
            XCTFail("Expected skipped response")
            return
        }
        XCTAssertEqual(reason, "Notifications disabled")
    }

    // MARK: - Tunnel Tests

    func testTunnelStatusDecoding() throws {
        let runningJSON = """
        {
            "state": "running",
            "publicUrl": "https://abc123.ngrok.io"
        }
        """

        let running = try decoder.decode(TunnelStatus.self, from: runningJSON.data(using: .utf8)!)
        XCTAssertEqual(running.state, .running)
        XCTAssertEqual(running.publicUrl, "https://abc123.ngrok.io")

        let errorJSON = """
        {
            "state": "error",
            "error": "Failed to connect"
        }
        """

        let error = try decoder.decode(TunnelStatus.self, from: errorJSON.data(using: .utf8)!)
        XCTAssertEqual(error.state, .error)
        XCTAssertEqual(error.error, "Failed to connect")
    }

    // MARK: - ApiResponse Tests

    func testApiResponseSuccessDecoding() throws {
        let json = """
        {
            "success": true,
            "data": {
                "identity": "overseer"
            },
            "timestamp": "2024-01-15T10:00:00.000Z"
        }
        """

        let response = try decoder.decode(ApiResponse<IdentityResponse>.self, from: json.data(using: .utf8)!)

        XCTAssertTrue(response.success)
        XCTAssertNotNil(response.data)
        XCTAssertEqual(response.data?.identity, "overseer")
        XCTAssertNil(response.error)
    }

    func testApiResponseErrorDecoding() throws {
        let json = """
        {
            "success": false,
            "error": {
                "code": "NOT_FOUND",
                "message": "Message not found",
                "details": "Message ID gb-invalid does not exist"
            },
            "timestamp": "2024-01-15T10:00:00.000Z"
        }
        """

        let response = try decoder.decode(ApiResponse<IdentityResponse>.self, from: json.data(using: .utf8)!)

        XCTAssertFalse(response.success)
        XCTAssertNil(response.data)
        XCTAssertNotNil(response.error)
        XCTAssertEqual(response.error?.code, "NOT_FOUND")
        XCTAssertEqual(response.error?.message, "Message not found")
        XCTAssertEqual(response.error?.details, "Message ID gb-invalid does not exist")
    }

    // MARK: - PaginatedResponse Tests

    func testPaginatedResponseDecoding() throws {
        let json = """
        {
            "items": [
                {
                    "id": "gb-1",
                    "from": "mayor/",
                    "to": "user",
                    "subject": "Test",
                    "body": "Body",
                    "timestamp": "2024-01-15T10:00:00.000Z",
                    "read": false,
                    "priority": 2,
                    "type": "notification",
                    "threadId": "thread-1",
                    "pinned": false,
                    "isInfrastructure": false
                }
            ],
            "total": 100,
            "hasMore": true
        }
        """

        let response = try decoder.decode(PaginatedResponse<Message>.self, from: json.data(using: .utf8)!)

        XCTAssertEqual(response.items.count, 1)
        XCTAssertEqual(response.total, 100)
        XCTAssertTrue(response.hasMore)
    }
}
