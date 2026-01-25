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
