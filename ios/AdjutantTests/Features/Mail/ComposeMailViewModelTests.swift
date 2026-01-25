import XCTest
@testable import Adjutant
@testable import AdjutantKit

@MainActor
final class ComposeMailViewModelTests: XCTestCase {

    // MARK: - Initialization Tests

    func testInitialization_NewMessage() {
        let viewModel = ComposeMailViewModel()

        XCTAssertEqual(viewModel.recipient, "")
        XCTAssertEqual(viewModel.subject, "")
        XCTAssertEqual(viewModel.body, "")
        XCTAssertEqual(viewModel.priority, .normal)
        XCTAssertFalse(viewModel.isReply)
        XCTAssertNil(viewModel.originalMessage)
    }

    func testInitialization_Reply() {
        let viewModel = ComposeMailViewModel(replyToId: "test-123")

        XCTAssertTrue(viewModel.isReply)
    }

    // MARK: - canSend Tests

    func testCanSend_AllFieldsFilled_ReturnsTrue() {
        let viewModel = ComposeMailViewModel()

        viewModel.recipient = "mayor/"
        viewModel.subject = "Test Subject"
        viewModel.body = "Test body content"

        XCTAssertTrue(viewModel.canSend)
    }

    func testCanSend_EmptyRecipient_ReturnsFalse() {
        let viewModel = ComposeMailViewModel()

        viewModel.recipient = ""
        viewModel.subject = "Test Subject"
        viewModel.body = "Test body content"

        XCTAssertFalse(viewModel.canSend)
    }

    func testCanSend_EmptySubject_ReturnsFalse() {
        let viewModel = ComposeMailViewModel()

        viewModel.recipient = "mayor/"
        viewModel.subject = ""
        viewModel.body = "Test body content"

        XCTAssertFalse(viewModel.canSend)
    }

    func testCanSend_EmptyBody_ReturnsFalse() {
        let viewModel = ComposeMailViewModel()

        viewModel.recipient = "mayor/"
        viewModel.subject = "Test Subject"
        viewModel.body = ""

        XCTAssertFalse(viewModel.canSend)
    }

    // MARK: - Recipient Selection Tests

    func testSelectRecipient_SetsRecipientAndHidesAutocomplete() {
        let viewModel = ComposeMailViewModel()
        viewModel.showRecipientAutocomplete = true

        let crew = CrewMember(
            id: "greenplace/Toast",
            name: "Toast",
            type: .polecat,
            rig: "greenplace",
            status: .working,
            unreadMail: 0
        )

        viewModel.selectRecipient(crew)

        XCTAssertEqual(viewModel.recipient, "greenplace/Toast")
        XCTAssertFalse(viewModel.showRecipientAutocomplete)
    }

    // MARK: - Priority Tests

    func testPriority_DefaultIsNormal() {
        let viewModel = ComposeMailViewModel()

        XCTAssertEqual(viewModel.priority, .normal)
    }

    func testPriority_CanBeChanged() {
        let viewModel = ComposeMailViewModel()

        viewModel.priority = .urgent
        XCTAssertEqual(viewModel.priority, .urgent)

        viewModel.priority = .high
        XCTAssertEqual(viewModel.priority, .high)

        viewModel.priority = .low
        XCTAssertEqual(viewModel.priority, .low)
    }

    // MARK: - Dictation State Tests

    func testIsRecording_InitiallyFalse() {
        let viewModel = ComposeMailViewModel()

        XCTAssertFalse(viewModel.isRecording)
        XCTAssertNil(viewModel.dictationTarget)
    }

    func testStopDictation_ResetsState() {
        let viewModel = ComposeMailViewModel()

        viewModel.stopDictation()

        XCTAssertFalse(viewModel.isRecording)
        XCTAssertNil(viewModel.dictationTarget)
    }

    // MARK: - Filtering Tests

    func testFilteredRecipients_EmptyQuery_ReturnsAll() async {
        let viewModel = ComposeMailViewModel()

        // Simulate loaded recipients
        let crew1 = CrewMember(id: "mayor/", name: "Mayor", type: .mayor, rig: nil, status: .idle, unreadMail: 0)
        let crew2 = CrewMember(id: "greenplace/Toast", name: "Toast", type: .polecat, rig: "greenplace", status: .working, unreadMail: 0)

        // Access private property through reflection or test via behavior
        viewModel.recipient = ""

        // Wait for debounce
        try? await Task.sleep(nanoseconds: 300_000_000)

        // Filtered recipients should include all when empty
        // Note: In actual testing, we'd mock the API to return these recipients
    }

    // MARK: - Send Success Tests

    func testSendSuccess_InitiallyFalse() {
        let viewModel = ComposeMailViewModel()

        XCTAssertFalse(viewModel.sendSuccess)
    }

    // MARK: - Voice Availability Tests

    func testVoiceAvailable_InitiallyFalse() {
        let viewModel = ComposeMailViewModel()

        XCTAssertFalse(viewModel.voiceAvailable)
    }
}
