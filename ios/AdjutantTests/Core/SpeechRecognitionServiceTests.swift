import XCTest
import Combine
import Speech
@testable import Adjutant

@MainActor
final class SpeechRecognitionServiceTests: XCTestCase {

    var sut: SpeechRecognitionService!
    var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        try await super.setUp()
        sut = SpeechRecognitionService()
        cancellables = []
    }

    override func tearDown() async throws {
        sut = nil
        cancellables = nil
        try await super.tearDown()
    }

    // MARK: - Initial State Tests

    func testInitialStateIsIdle() {
        XCTAssertEqual(sut.state, .idle)
    }

    func testInitialTranscriptionIsEmpty() {
        XCTAssertTrue(sut.transcription.isEmpty)
    }

    func testInitialFinalTranscriptionIsNil() {
        XCTAssertNil(sut.finalTranscription)
    }

    // MARK: - Authorization Status Tests

    func testAuthorizationStatusMappings() {
        XCTAssertFalse(SpeechAuthorizationStatus.notDetermined.canRecord)
        XCTAssertFalse(SpeechAuthorizationStatus.denied.canRecord)
        XCTAssertFalse(SpeechAuthorizationStatus.restricted.canRecord)
        XCTAssertFalse(SpeechAuthorizationStatus.microphoneDenied.canRecord)
        XCTAssertTrue(SpeechAuthorizationStatus.authorized.canRecord)
    }

    func testAuthorizationStatusErrorMessages() {
        XCTAssertNil(SpeechAuthorizationStatus.notDetermined.errorMessage)
        XCTAssertNotNil(SpeechAuthorizationStatus.denied.errorMessage)
        XCTAssertNotNil(SpeechAuthorizationStatus.restricted.errorMessage)
        XCTAssertNotNil(SpeechAuthorizationStatus.microphoneDenied.errorMessage)
        XCTAssertNil(SpeechAuthorizationStatus.authorized.errorMessage)
    }

    // MARK: - Recognition State Tests

    func testRecognitionStateIsRecording() {
        XCTAssertFalse(RecognitionState.idle.isRecording)
        XCTAssertFalse(RecognitionState.starting.isRecording)
        XCTAssertTrue(RecognitionState.recording.isRecording)
        XCTAssertFalse(RecognitionState.processing.isRecording)
        XCTAssertFalse(RecognitionState.error(message: "test").isRecording)
    }

    func testRecognitionStateIsActive() {
        XCTAssertFalse(RecognitionState.idle.isActive)
        XCTAssertTrue(RecognitionState.starting.isActive)
        XCTAssertTrue(RecognitionState.recording.isActive)
        XCTAssertTrue(RecognitionState.processing.isActive)
        XCTAssertFalse(RecognitionState.error(message: "test").isActive)
    }

    // MARK: - State Publisher Tests

    func testStatePublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "State change published")
        var receivedStates: [RecognitionState] = []

        sut.statePublisher
            .sink { state in
                receivedStates.append(state)
                if receivedStates.count >= 1 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertTrue(receivedStates.contains(.idle))
    }

    func testTranscriptionPublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "Transcription change published")
        var receivedTranscription: String?

        sut.transcriptionPublisher
            .sink { text in
                receivedTranscription = text
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(receivedTranscription, "")
    }

    func testFinalTranscriptionPublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "Final transcription change published")
        var receivedFinal: String??

        sut.finalTranscriptionPublisher
            .sink { text in
                receivedFinal = text
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertNil(receivedFinal as? String)
    }

    func testAuthorizationStatusPublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "Authorization status change published")
        var receivedStatus: SpeechAuthorizationStatus?

        sut.authorizationStatusPublisher
            .sink { status in
                receivedStatus = status
                expectation.fulfill()
            }
            .store(in: &cancellables)

        wait(for: [expectation], timeout: 1.0)
        XCTAssertNotNil(receivedStatus)
    }

    // MARK: - Recording Without Authorization Tests

    func testStartRecordingThrowsWhenNotAuthorized() {
        // When not authorized, startRecording should throw
        XCTAssertThrowsError(try sut.startRecording()) { error in
            // Should be either recognizerUnavailable or notAuthorized
            XCTAssertTrue(error is SpeechRecognitionError)
        }
    }

    func testCancelRecordingWhenNotRecordingSetsIdleState() {
        sut.cancelRecording()
        XCTAssertEqual(sut.state, .idle)
    }

    func testStopRecordingWhenNotRecordingDoesNothing() {
        sut.stopRecording()
        XCTAssertEqual(sut.state, .idle)
    }

    // MARK: - Error Tests

    func testSpeechRecognitionErrorDescriptions() {
        XCTAssertNotNil(SpeechRecognitionError.recognizerUnavailable.errorDescription)
        XCTAssertNotNil(SpeechRecognitionError.notAuthorized(.denied).errorDescription)
        XCTAssertNotNil(SpeechRecognitionError.audioSessionFailed(NSError(domain: "test", code: 1)).errorDescription)
        XCTAssertNotNil(SpeechRecognitionError.audioEngineFailed(NSError(domain: "test", code: 1)).errorDescription)
        XCTAssertNotNil(SpeechRecognitionError.requestCreationFailed.errorDescription)
        XCTAssertNotNil(SpeechRecognitionError.recognitionFailed(NSError(domain: "test", code: 1)).errorDescription)
    }

    // MARK: - Locale Initialization Tests

    func testInitWithLocale() {
        let service = SpeechRecognitionService(locale: Locale(identifier: "en-US"))
        XCTAssertEqual(service.state, .idle)
    }

    // MARK: - State Equality Tests

    func testRecognitionStateEquality() {
        XCTAssertEqual(RecognitionState.idle, RecognitionState.idle)
        XCTAssertEqual(RecognitionState.starting, RecognitionState.starting)
        XCTAssertEqual(RecognitionState.recording, RecognitionState.recording)
        XCTAssertEqual(RecognitionState.processing, RecognitionState.processing)
        XCTAssertEqual(RecognitionState.error(message: "test"), RecognitionState.error(message: "test"))
        XCTAssertNotEqual(RecognitionState.idle, RecognitionState.recording)
        XCTAssertNotEqual(RecognitionState.error(message: "a"), RecognitionState.error(message: "b"))
    }

    func testSpeechAuthorizationStatusEquality() {
        XCTAssertEqual(SpeechAuthorizationStatus.notDetermined, SpeechAuthorizationStatus.notDetermined)
        XCTAssertEqual(SpeechAuthorizationStatus.denied, SpeechAuthorizationStatus.denied)
        XCTAssertEqual(SpeechAuthorizationStatus.restricted, SpeechAuthorizationStatus.restricted)
        XCTAssertEqual(SpeechAuthorizationStatus.authorized, SpeechAuthorizationStatus.authorized)
        XCTAssertEqual(SpeechAuthorizationStatus.microphoneDenied, SpeechAuthorizationStatus.microphoneDenied)
        XCTAssertNotEqual(SpeechAuthorizationStatus.authorized, SpeechAuthorizationStatus.denied)
    }
}

// MARK: - Mock Speech Recognition Service

/// Mock implementation of SpeechRecognitionServiceProtocol for testing view models
@MainActor
final class MockSpeechRecognitionService: SpeechRecognitionServiceProtocol {
    typealias ServiceError = SpeechRecognitionError

    var isAvailable: Bool {
        get async { _isAvailable }
    }
    var _isAvailable: Bool = true

    @Published var state: RecognitionState = .idle
    @Published var transcription: String = ""
    @Published var finalTranscription: String?
    @Published var authorizationStatus: SpeechAuthorizationStatus = .notDetermined

    var statePublisher: AnyPublisher<RecognitionState, Never> {
        $state.eraseToAnyPublisher()
    }

    var transcriptionPublisher: AnyPublisher<String, Never> {
        $transcription.eraseToAnyPublisher()
    }

    var finalTranscriptionPublisher: AnyPublisher<String?, Never> {
        $finalTranscription.eraseToAnyPublisher()
    }

    var authorizationStatusPublisher: AnyPublisher<SpeechAuthorizationStatus, Never> {
        $authorizationStatus.eraseToAnyPublisher()
    }

    // Tracking for tests
    var requestAuthorizationCalled = false
    var startRecordingCalled = false
    var stopRecordingCalled = false
    var cancelRecordingCalled = false

    // Configurable behavior
    var authorizationToReturn: SpeechAuthorizationStatus = .authorized
    var shouldThrowOnStartRecording: Bool = false

    func requestAuthorization() async -> SpeechAuthorizationStatus {
        requestAuthorizationCalled = true
        authorizationStatus = authorizationToReturn
        return authorizationToReturn
    }

    func startRecording() throws {
        startRecordingCalled = true
        if shouldThrowOnStartRecording {
            throw SpeechRecognitionError.recognizerUnavailable
        }
        state = .recording
    }

    func stopRecording() {
        stopRecordingCalled = true
        state = .processing
        // Simulate finalization
        let text = transcription
        finalTranscription = text.isEmpty ? nil : text
        state = .idle
    }

    func cancelRecording() {
        cancelRecordingCalled = true
        transcription = ""
        finalTranscription = nil
        state = .idle
    }

    // Helper methods for tests
    func simulateTranscription(_ text: String) {
        transcription = text
    }

    func simulateFinalTranscription(_ text: String) {
        finalTranscription = text
    }

    func simulateError(_ message: String) {
        state = .error(message: message)
    }
}
