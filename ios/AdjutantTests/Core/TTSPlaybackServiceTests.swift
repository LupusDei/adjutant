import XCTest
import Combine
import AVFoundation
import AdjutantKit
@testable import AdjutantUI

@MainActor
final class TTSPlaybackServiceTests: XCTestCase {

    var sut: TTSPlaybackService!
    var mockAPIClient: MockAPIClient!
    var cancellables: Set<AnyCancellable>!

    override func setUp() async throws {
        try await super.setUp()
        mockAPIClient = MockAPIClient()
        sut = TTSPlaybackService(
            apiClient: mockAPIClient.client,
            baseURL: URL(string: "http://localhost:3000")!
        )
        cancellables = []
    }

    override func tearDown() async throws {
        sut = nil
        mockAPIClient = nil
        cancellables = nil
        try await super.tearDown()
    }

    // MARK: - Initial State Tests

    func testInitialStateIsIdle() {
        XCTAssertEqual(sut.state, .idle)
    }

    func testInitialQueueIsEmpty() {
        XCTAssertTrue(sut.queue.isEmpty)
    }

    func testInitialVolumeIsMax() {
        XCTAssertEqual(sut.volume, 1.0, accuracy: 0.01)
    }

    // MARK: - Queue Management Tests

    func testEnqueueAddsItemToQueue() {
        let item = makePlaybackItem()
        sut.enqueue(item)

        XCTAssertEqual(sut.queue.count, 1)
        XCTAssertEqual(sut.queue.first?.id, item.id)
    }

    func testEnqueueMultipleItemsPreservesPriorityOrder() {
        let lowPriority = makePlaybackItem(priority: .low)
        let highPriority = makePlaybackItem(priority: .high)
        let normalPriority = makePlaybackItem(priority: .normal)

        sut.enqueue(lowPriority)
        sut.enqueue(normalPriority)
        sut.enqueue(highPriority)

        // Queue should be ordered by priority: high, normal, low
        XCTAssertEqual(sut.queue.count, 3)
        XCTAssertEqual(sut.queue[0].priority, .high)
        XCTAssertEqual(sut.queue[1].priority, .normal)
        XCTAssertEqual(sut.queue[2].priority, .low)
    }

    func testDequeueRemovesSpecificItem() {
        let item1 = makePlaybackItem()
        let item2 = makePlaybackItem()

        sut.enqueue(item1)
        sut.enqueue(item2)
        sut.dequeue(id: item1.id)

        XCTAssertEqual(sut.queue.count, 1)
        XCTAssertEqual(sut.queue.first?.id, item2.id)
    }

    func testClearQueueRemovesAllItems() {
        sut.enqueue(makePlaybackItem())
        sut.enqueue(makePlaybackItem())
        sut.enqueue(makePlaybackItem())

        sut.clearQueue()

        XCTAssertTrue(sut.queue.isEmpty)
    }

    // MARK: - Playback State Tests

    func testStopSetsStateToIdle() {
        // Even if playing, stop should set state to idle
        sut.stop()
        XCTAssertEqual(sut.state, .idle)
    }

    func testPauseDoesNothingWhenIdle() {
        sut.pause()
        XCTAssertEqual(sut.state, .idle)
    }

    // MARK: - Volume Tests

    func testVolumeCanBeSet() {
        sut.volume = 0.5
        XCTAssertEqual(sut.volume, 0.5, accuracy: 0.01)
    }

    func testVolumePublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "Volume change published")
        var receivedVolume: Float?

        sut.volumePublisher
            .dropFirst() // Skip initial value
            .sink { volume in
                receivedVolume = volume
                expectation.fulfill()
            }
            .store(in: &cancellables)

        sut.volume = 0.75

        wait(for: [expectation], timeout: 1.0)
        XCTAssertEqual(Double(receivedVolume ?? 0), 0.75, accuracy: 0.01)
    }

    // MARK: - State Publisher Tests

    func testStatePublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "State change published")
        var receivedStates: [PlaybackState] = []

        sut.statePublisher
            .sink { state in
                receivedStates.append(state)
                if receivedStates.count >= 2 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        sut.stop() // Forces idle state

        wait(for: [expectation], timeout: 1.0)
        XCTAssertTrue(receivedStates.contains(.idle))
    }

    // MARK: - Queue Publisher Tests

    func testQueuePublisherEmitsChanges() {
        let expectation = XCTestExpectation(description: "Queue change published")
        var receivedQueueCounts: [Int] = []

        sut.queuePublisher
            .sink { queue in
                receivedQueueCounts.append(queue.count)
                if receivedQueueCounts.count >= 2 {
                    expectation.fulfill()
                }
            }
            .store(in: &cancellables)

        sut.enqueue(makePlaybackItem())

        wait(for: [expectation], timeout: 1.0)
        XCTAssertTrue(receivedQueueCounts.contains(1))
    }

    // MARK: - PlaybackItem Tests

    func testPlaybackItemEquality() {
        let id = UUID()
        let item1 = PlaybackItem(
            id: id,
            text: "Test",
            audioURL: URL(string: "http://test.com/audio.mp3")!,
            duration: 5.0,
            voiceId: "voice1"
        )
        let item2 = PlaybackItem(
            id: id,
            text: "Test",
            audioURL: URL(string: "http://test.com/audio.mp3")!,
            duration: 5.0,
            voiceId: "voice1"
        )

        XCTAssertEqual(item1, item2)
    }

    func testPlaybackPriorityComparison() {
        XCTAssertLessThan(PlaybackPriority.low, PlaybackPriority.normal)
        XCTAssertLessThan(PlaybackPriority.normal, PlaybackPriority.high)
        XCTAssertLessThan(PlaybackPriority.high, PlaybackPriority.urgent)
    }

    // MARK: - PlaybackState Tests

    func testPlaybackStateIsPlaying() {
        let item = makePlaybackItem()
        let playingState = PlaybackState.playing(item: item)
        let pausedState = PlaybackState.paused(item: item)
        let idleState = PlaybackState.idle

        XCTAssertTrue(playingState.isPlaying)
        XCTAssertFalse(pausedState.isPlaying)
        XCTAssertFalse(idleState.isPlaying)
    }

    func testPlaybackStateIsPaused() {
        let item = makePlaybackItem()
        let playingState = PlaybackState.playing(item: item)
        let pausedState = PlaybackState.paused(item: item)
        let idleState = PlaybackState.idle

        XCTAssertFalse(playingState.isPaused)
        XCTAssertTrue(pausedState.isPaused)
        XCTAssertFalse(idleState.isPaused)
    }

    func testPlaybackStateCurrentItem() {
        let item = makePlaybackItem()

        XCTAssertNil(PlaybackState.idle.currentItem)
        XCTAssertNil(PlaybackState.loading.currentItem)
        XCTAssertEqual(PlaybackState.playing(item: item).currentItem, item)
        XCTAssertEqual(PlaybackState.paused(item: item).currentItem, item)
        XCTAssertNil(PlaybackState.error(message: "error").currentItem)
    }

    // MARK: - Error Tests

    func testTTSPlaybackErrorDescriptions() {
        XCTAssertNotNil(TTSPlaybackError.audioSessionConfigurationFailed.errorDescription)
        XCTAssertNotNil(TTSPlaybackError.playbackFailed.errorDescription)
        XCTAssertNotNil(TTSPlaybackError.invalidAudioData.errorDescription)

        let networkError = TTSPlaybackError.networkError(NSError(domain: "test", code: 1))
        XCTAssertNotNil(networkError.errorDescription)
        XCTAssertTrue(networkError.errorDescription?.contains("Network error") ?? false)
    }

    // MARK: - Enqueue from SynthesizeResponse Tests

    func testEnqueueFromSynthesizeResponse() {
        let response = SynthesizeResponse(
            audioUrl: "/voice/audio/test.mp3",
            duration: 3.5,
            cached: false,
            voiceId: "test-voice"
        )

        sut.enqueue(
            text: "Hello world",
            response: response,
            priority: .high,
            metadata: ["source": "test"]
        )

        XCTAssertEqual(sut.queue.count, 1)
        let item = sut.queue.first
        XCTAssertEqual(item?.text, "Hello world")
        XCTAssertEqual(item?.voiceId, "test-voice")
        XCTAssertEqual(item?.priority, .high)
        XCTAssertEqual(item?.metadata["source"], "test")
    }

    // MARK: - Helper Methods

    private func makePlaybackItem(priority: PlaybackPriority = .normal) -> PlaybackItem {
        PlaybackItem(
            text: "Test audio \(UUID().uuidString)",
            audioURL: URL(string: "http://localhost:3000/voice/audio/test.mp3")!,
            duration: 2.5,
            voiceId: "test-voice",
            priority: priority
        )
    }
}

// MARK: - Mock API Client

/// Mock wrapper for APIClient used in testing
final class MockAPIClient {
    let client: APIClient

    init() {
        let config = APIClientConfiguration(
            baseURL: URL(string: "http://localhost:3000")!
        )
        client = APIClient(configuration: config)
    }
}
