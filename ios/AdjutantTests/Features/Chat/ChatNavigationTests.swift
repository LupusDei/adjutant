import XCTest
@testable import AdjutantUI

/// App-shell DM ↔ Channels navigation tests (adj-164.6.5 / T028).
///
/// The chat tab hosts two surfaces — direct messages and channels — switched by
/// a single mode controller. Switching modes must (a) flip the active surface
/// and (b) preserve each surface's own selection so flipping back restores it.
@MainActor
final class ChatNavigationTests: XCTestCase {

    func testDefaultsToDirectMessages() {
        let controller = ChatModeController()
        XCTAssertEqual(controller.mode, .directMessages)
    }

    func testSwitchToChannelsChangesMode() {
        let controller = ChatModeController()
        controller.switchTo(.channels)
        XCTAssertEqual(controller.mode, .channels)
    }

    func testToggleFlipsBetweenModes() {
        let controller = ChatModeController()
        controller.toggle()
        XCTAssertEqual(controller.mode, .channels)
        controller.toggle()
        XCTAssertEqual(controller.mode, .directMessages)
    }

    func testSwitchingModesPreservesEachSurfaceSelection() {
        let controller = ChatModeController()
        // Operator is reading a DM with raynor.
        controller.selectedDMRecipient = "raynor"
        // Switch to channels and open one.
        controller.switchTo(.channels)
        controller.selectedChannelId = "chan-ops"

        // Flipping back to DMs restores the DM recipient, not the channel.
        controller.switchTo(.directMessages)
        XCTAssertEqual(controller.mode, .directMessages)
        XCTAssertEqual(controller.selectedDMRecipient, "raynor")

        // And flipping forward again restores the open channel.
        controller.switchTo(.channels)
        XCTAssertEqual(controller.selectedChannelId, "chan-ops")
    }

    func testSwitchingToSameModeIsIdempotent() {
        let controller = ChatModeController()
        controller.selectedDMRecipient = "kerrigan"
        controller.switchTo(.directMessages)
        XCTAssertEqual(controller.mode, .directMessages)
        XCTAssertEqual(controller.selectedDMRecipient, "kerrigan")
    }
}
