import XCTest
@testable import AdjutantUI

@MainActor
final class NotificationStatusIndicatorTests: XCTestCase {

    override func setUp() async throws {
        // Reset AppState to known values
        AppState.shared.updateVoiceAvailability(true)
        AppState.shared.isVoiceMuted = false

        // Clear UserDefaults
        UserDefaults.standard.removeObject(forKey: "isVoiceMuted")
    }

    override func tearDown() async throws {
        // Reset after tests
        AppState.shared.updateVoiceAvailability(true)
        AppState.shared.isVoiceMuted = false
        UserDefaults.standard.removeObject(forKey: "isVoiceMuted")
    }

    // MARK: - AppState Voice Muted Tests

    func testVoiceMutedDefaultValue() {
        // Fresh AppState should have voice unmuted
        XCTAssertFalse(AppState.shared.isVoiceMuted)
    }

    func testVoiceMutedToggle() {
        AppState.shared.isVoiceMuted = true
        XCTAssertTrue(AppState.shared.isVoiceMuted)

        AppState.shared.isVoiceMuted = false
        XCTAssertFalse(AppState.shared.isVoiceMuted)
    }

    func testVoiceMutedPersistence() {
        AppState.shared.isVoiceMuted = true

        // Give time for the Combine sink to fire
        let expectation = XCTestExpectation(description: "Wait for persistence")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 1.0)

        XCTAssertTrue(UserDefaults.standard.bool(forKey: "isVoiceMuted"))
    }

    // MARK: - Voice Availability Tests

    func testVoiceAvailableByDefault() {
        XCTAssertTrue(AppState.shared.isVoiceAvailable)
    }

    func testUpdateVoiceAvailability() {
        AppState.shared.updateVoiceAvailability(false)
        XCTAssertFalse(AppState.shared.isVoiceAvailable)

        AppState.shared.updateVoiceAvailability(true)
        XCTAssertTrue(AppState.shared.isVoiceAvailable)
    }

    // MARK: - State Combinations Tests

    func testAvailableAndUnmutedState() {
        AppState.shared.updateVoiceAvailability(true)
        AppState.shared.isVoiceMuted = false

        XCTAssertTrue(AppState.shared.isVoiceAvailable)
        XCTAssertFalse(AppState.shared.isVoiceMuted)
    }

    func testAvailableAndMutedState() {
        AppState.shared.updateVoiceAvailability(true)
        AppState.shared.isVoiceMuted = true

        XCTAssertTrue(AppState.shared.isVoiceAvailable)
        XCTAssertTrue(AppState.shared.isVoiceMuted)
    }

    func testUnavailableState() {
        AppState.shared.updateVoiceAvailability(false)

        XCTAssertFalse(AppState.shared.isVoiceAvailable)
        // Muted state still exists but shouldn't matter when unavailable
    }

    // MARK: - Mute State Independence Tests

    func testMuteStatePreservedWhenAvailabilityChanges() {
        // Start muted
        AppState.shared.isVoiceMuted = true
        XCTAssertTrue(AppState.shared.isVoiceMuted)

        // Voice becomes unavailable
        AppState.shared.updateVoiceAvailability(false)
        XCTAssertTrue(AppState.shared.isVoiceMuted) // Mute state preserved

        // Voice becomes available again
        AppState.shared.updateVoiceAvailability(true)
        XCTAssertTrue(AppState.shared.isVoiceMuted) // Still muted
    }
}
