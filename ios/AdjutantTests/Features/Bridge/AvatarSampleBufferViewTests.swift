import AVFoundation
import CoreVideo
import XCTest
@testable import AdjutantUI

/// Tests for the sample-buffer renderer (adj-207.4.3 / T010).
///
/// `AvatarSampleBufferRenderer` turns decoded avatar frames into display-immediately
/// `CMSampleBuffer`s and enqueues them into an `AVSampleBufferDisplayLayer` (which PiP
/// then controls). These tests pin the back-pressure + stall-recovery behaviour against
/// a spy display seam, plus the real CMSampleBuffer construction from a CVPixelBuffer.
@MainActor
final class AvatarSampleBufferViewTests: XCTestCase {

    // MARK: - Spy display

    private final class SpyDisplay: SampleBufferDisplaying {
        var isReadyForMoreMediaData = true
        var renderStatus: SampleBufferRenderStatus = .rendering

        private(set) var enqueued: [CMSampleBuffer] = []
        private(set) var flushCount = 0
        private(set) var log: [String] = []

        func enqueue(_ sampleBuffer: CMSampleBuffer) {
            enqueued.append(sampleBuffer)
            log.append("enqueue")
        }
        func flush() {
            flushCount += 1
            log.append("flush")
        }
    }

    // MARK: - Helpers

    private func makePixelBuffer() -> CVPixelBuffer {
        var pb: CVPixelBuffer?
        let attrs: [String: Any] = [kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
        CVPixelBufferCreate(kCFAllocatorDefault, 64, 64, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
        return pb!
    }

    private func makeFrame() -> NativeAvatarVideoFrame {
        NativeAvatarVideoFrame(pixelBuffer: makePixelBuffer(), timeStampNs: 0)
    }

    /// Renderer whose sample-buffer maker always succeeds with a stub buffer, so the
    /// gating logic is isolated from real CMSampleBuffer creation.
    private func makeRenderer(display: SpyDisplay) -> AvatarSampleBufferRenderer {
        let stub = makeStubSampleBuffer()
        return AvatarSampleBufferRenderer(display: display, makeSampleBuffer: { _ in stub })
    }

    private func makeStubSampleBuffer() -> CMSampleBuffer {
        // A minimal real CMSampleBuffer around a pixel buffer (reused across enqueues).
        AvatarSampleBufferRenderer.makeDisplayImmediateSampleBuffer(from: makeFrame())!
    }

    // MARK: - Enqueue gating

    func testEnqueuesWhenReady() {
        let display = SpyDisplay()
        let renderer = makeRenderer(display: display)

        renderer.enqueue(makeFrame())

        XCTAssertEqual(display.enqueued.count, 1)
        XCTAssertEqual(renderer.enqueuedCount, 1)
        XCTAssertEqual(renderer.droppedCount, 0)
    }

    func testDropsFrameWhenNotReady() {
        let display = SpyDisplay()
        display.isReadyForMoreMediaData = false
        let renderer = makeRenderer(display: display)

        renderer.enqueue(makeFrame())

        XCTAssertTrue(display.enqueued.isEmpty, "must not enqueue under back-pressure")
        XCTAssertEqual(renderer.droppedCount, 1)
        XCTAssertEqual(renderer.enqueuedCount, 0)
    }

    // MARK: - Stall / failure recovery

    func testFlushesAndRecoversWhenLayerFailed() {
        let display = SpyDisplay()
        display.renderStatus = .failed
        let renderer = makeRenderer(display: display)

        renderer.enqueue(makeFrame())

        // Failed → flush first, THEN enqueue (recovered, not frozen).
        XCTAssertEqual(display.log, ["flush", "enqueue"])
        XCTAssertEqual(renderer.recoveryFlushCount, 1)
        XCTAssertEqual(renderer.enqueuedCount, 1)
    }

    func testFailedButNotReadyFlushesAndDrops() {
        let display = SpyDisplay()
        display.renderStatus = .failed
        display.isReadyForMoreMediaData = false
        let renderer = makeRenderer(display: display)

        renderer.enqueue(makeFrame())

        // Recovery flush happens, but back-pressure still prevents the enqueue.
        XCTAssertEqual(display.log, ["flush"])
        XCTAssertEqual(renderer.recoveryFlushCount, 1)
        XCTAssertEqual(renderer.droppedCount, 1)
    }

    func testSinkFlushForwardsToDisplay() {
        let display = SpyDisplay()
        let renderer = makeRenderer(display: display)

        renderer.flush()

        XCTAssertEqual(display.flushCount, 1)
    }

    // MARK: - Real CMSampleBuffer construction

    func testMakeDisplayImmediateSampleBufferProducesReadyBuffer() throws {
        let frame = makeFrame()
        let sample = AvatarSampleBufferRenderer.makeDisplayImmediateSampleBuffer(from: frame)

        let unwrapped = try XCTUnwrap(sample, "should build a CMSampleBuffer from a valid pixel buffer")
        XCTAssertTrue(CMSampleBufferIsValid(unwrapped))
        XCTAssertTrue(CMSampleBufferDataIsReady(unwrapped))

        // Display-immediately attachment is set on the sample.
        let attachments = CMSampleBufferGetSampleAttachmentsArray(unwrapped, createIfNecessary: false) as NSArray?
        let dict = try XCTUnwrap(attachments?.firstObject as? NSDictionary)
        XCTAssertEqual(dict[kCMSampleAttachmentKey_DisplayImmediately as NSString] as? Bool, true)
    }

    func testRealSampleBufferMakerEnqueuesEndToEnd() {
        // Use the DEFAULT sample-buffer maker (real construction), not the stub.
        let display = SpyDisplay()
        let renderer = AvatarSampleBufferRenderer(display: display)

        renderer.enqueue(makeFrame())

        XCTAssertEqual(renderer.enqueuedCount, 1)
        XCTAssertEqual(display.enqueued.count, 1)
    }

    // MARK: - First-frame signal (adj-207.5.8)

    func testOnFirstFrameFiresOnceOnFirstEnqueue() {
        let display = SpyDisplay()
        let renderer = makeRenderer(display: display)
        var fireCount = 0
        renderer.onFirstFrame = { fireCount += 1 }

        renderer.enqueue(makeFrame())
        renderer.enqueue(makeFrame())
        renderer.enqueue(makeFrame())

        XCTAssertEqual(fireCount, 1, "onFirstFrame fires exactly once, on the FIRST enqueued frame")
    }

    func testResetFirstFrameReArmsTheSignal() {
        let display = SpyDisplay()
        let renderer = makeRenderer(display: display)
        var fireCount = 0
        renderer.onFirstFrame = { fireCount += 1 }

        renderer.enqueue(makeFrame())    // fires (1)
        renderer.resetFirstFrame()       // re-arm for the next session
        renderer.enqueue(makeFrame())    // fires again (2)

        XCTAssertEqual(fireCount, 2, "reset re-arms onFirstFrame for the next swap session")
    }

    func testOnFirstFrameDoesNotFireWhenFrameDropped() {
        let display = SpyDisplay()
        display.isReadyForMoreMediaData = false // back-pressure → frame dropped, not enqueued
        let renderer = makeRenderer(display: display)
        var fired = false
        renderer.onFirstFrame = { fired = true }

        renderer.enqueue(makeFrame())

        XCTAssertFalse(fired, "onFirstFrame only fires on an actual enqueue, not a dropped frame")
    }

    // MARK: - Hosting view

    func testHostingViewBacksAnAVSampleBufferDisplayLayer() {
        let view = AvatarSampleBufferUIView()
        XCTAssertTrue(view.layer is AVSampleBufferDisplayLayer)
        XCTAssertIdentical(view.displayLayer, view.layer as? AVSampleBufferDisplayLayer)
    }
}
