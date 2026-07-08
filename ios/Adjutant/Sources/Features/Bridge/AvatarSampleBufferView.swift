import AVFoundation
import CoreMedia
import CoreVideo
import SwiftUI
import UIKit

// MARK: - Display seam

/// Rendering status of the sample-buffer display, mirrored from
/// `AVQueuedSampleBufferRenderingStatus` so the renderer's stall/flush logic is
/// unit-testable without a real `AVSampleBufferDisplayLayer`.
enum SampleBufferRenderStatus: Equatable, Sendable {
    case unknown
    case rendering
    /// The layer failed (decode/enqueue error) — it must be flushed before it will
    /// accept frames again.
    case failed
}

/// The `AVSampleBufferDisplayLayer` dependency behind a protocol so the renderer's
/// enqueue-gating + stall-recovery logic is unit-tested with a spy. `SystemSampleBufferDisplay`
/// forwards to the real layer in production.
@MainActor
protocol SampleBufferDisplaying: AnyObject {
    /// Whether the layer can accept more frames right now (back-pressure).
    var isReadyForMoreMediaData: Bool { get }
    /// Current rendering status (drives failure recovery).
    var renderStatus: SampleBufferRenderStatus { get }
    func enqueue(_ sampleBuffer: CMSampleBuffer)
    /// Drop queued frames + reset the layer (recover from `.failed`, or on stop).
    func flush()
}

// MARK: - Renderer (frame sink)

/// Enqueues decoded avatar frames into an `AVSampleBufferDisplayLayer` for display and
/// system PiP (adj-207.4.3). It is the `NativeAvatarFrameSink` the `NativeAvatarClient`
/// drives: each `NativeAvatarVideoFrame` becomes a display-immediately `CMSampleBuffer`.
///
/// Stall / failure handling (the load-bearing, tested behaviour):
///   - If the layer reports `.failed`, `flush()` it first so it will accept frames
///     again (recover instead of freezing on a black PiP window).
///   - Respect back-pressure: only enqueue when `isReadyForMoreMediaData`; otherwise
///     drop the frame (a live conversation prefers the freshest frame over a backlog).
///   - `flush()` (from the sink protocol) clears the display on stop / track change.
///
/// `@MainActor` — `AVSampleBufferDisplayLayer` enqueue must happen on the main thread,
/// and this is fed from the client's main-actor frame hop.
@MainActor
final class AvatarSampleBufferRenderer: NativeAvatarFrameSink {
    private let display: SampleBufferDisplaying
    private let makeSampleBuffer: @MainActor (NativeAvatarVideoFrame) -> CMSampleBuffer?

    /// Diagnostics for tests + debugging.
    private(set) var enqueuedCount = 0
    private(set) var droppedCount = 0
    private(set) var recoveryFlushCount = 0

    /// Whether the very first frame has been enqueued (so we log the "first frame"
    /// milestone once — the signal that PiP content is actually flowing, adj-207.5.3).
    private var didLogFirstFrame = false

    init(
        display: SampleBufferDisplaying,
        makeSampleBuffer: @escaping @MainActor (NativeAvatarVideoFrame) -> CMSampleBuffer? =
            AvatarSampleBufferRenderer.makeDisplayImmediateSampleBuffer
    ) {
        self.display = display
        self.makeSampleBuffer = makeSampleBuffer
    }

    // MARK: NativeAvatarFrameSink

    func enqueue(_ frame: NativeAvatarVideoFrame) {
        // Recover a failed layer before trying to enqueue (stall handling).
        if display.renderStatus == .failed {
            display.flush()
            recoveryFlushCount += 1
        }
        guard display.isReadyForMoreMediaData else {
            droppedCount += 1
            return
        }
        guard let sampleBuffer = makeSampleBuffer(frame) else {
            droppedCount += 1
            return
        }
        display.enqueue(sampleBuffer)
        enqueuedCount += 1
        if !didLogFirstFrame {
            didLogFirstFrame = true
            bridgePiPLog.info("renderer: FIRST avatar frame enqueued to AVSampleBufferDisplayLayer")
        }
    }

    func flush() {
        display.flush()
    }

    // MARK: CMSampleBuffer construction

    /// Wrap a decoded `CVPixelBuffer` in a **display-immediately** `CMSampleBuffer`.
    /// A live conversational avatar has no seek/timeline, so we render each frame as
    /// soon as it arrives rather than scheduling it on a timebase. Returns `nil` if a
    /// format description or sample buffer cannot be created.
    static func makeDisplayImmediateSampleBuffer(from frame: NativeAvatarVideoFrame) -> CMSampleBuffer? {
        let pixelBuffer = frame.pixelBuffer

        var formatDescription: CMVideoFormatDescription?
        let formatStatus = CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescriptionOut: &formatDescription
        )
        guard formatStatus == noErr, let formatDescription else { return nil }

        var timingInfo = CMSampleTimingInfo(
            duration: .invalid,
            presentationTimeStamp: .invalid,
            decodeTimeStamp: .invalid
        )

        var sampleBuffer: CMSampleBuffer?
        let sampleStatus = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: formatDescription,
            sampleTiming: &timingInfo,
            sampleBufferOut: &sampleBuffer
        )
        guard sampleStatus == noErr, let sampleBuffer else { return nil }

        // Tell the display layer to show this frame immediately (no timebase gating).
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: true) as? [NSMutableDictionary],
           let dict = attachments.first {
            dict[kCMSampleAttachmentKey_DisplayImmediately as NSString] = true
        }
        return sampleBuffer
    }
}

// MARK: - System display (production)

/// Production `SampleBufferDisplaying` wrapping a real `AVSampleBufferDisplayLayer`.
@MainActor
final class SystemSampleBufferDisplay: SampleBufferDisplaying {
    let layer: AVSampleBufferDisplayLayer

    init(layer: AVSampleBufferDisplayLayer = AVSampleBufferDisplayLayer()) {
        self.layer = layer
        layer.videoGravity = .resizeAspectFill
    }

    var isReadyForMoreMediaData: Bool { layer.isReadyForMoreMediaData }

    var renderStatus: SampleBufferRenderStatus {
        switch layer.status {
        case .rendering: return .rendering
        case .failed: return .failed
        case .unknown: return .unknown
        @unknown default: return .unknown
        }
    }

    func enqueue(_ sampleBuffer: CMSampleBuffer) {
        layer.enqueue(sampleBuffer)
    }

    func flush() {
        layer.flush()
    }
}

// MARK: - Hosting view

/// A `UIView` whose backing layer IS an `AVSampleBufferDisplayLayer`, so the native
/// avatar video is rendered directly into a PiP-capable layer (adj-207.4.3 → .4.4).
final class AvatarSampleBufferUIView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

    /// The typed display layer — handed to the PiP controller (adj-207.4.4) and wrapped
    /// by `SystemSampleBufferDisplay` for the renderer.
    var displayLayer: AVSampleBufferDisplayLayer {
        // Safe: `layerClass` guarantees the backing layer's type.
        // swiftlint:disable:next force_cast
        layer as! AVSampleBufferDisplayLayer
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        displayLayer.videoGravity = .resizeAspectFill
        backgroundColor = .black
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

/// SwiftUI wrapper hosting the `AvatarSampleBufferUIView`. The floating window / PiP
/// surface embeds this to show the native avatar video track.
struct AvatarSampleBufferView: UIViewRepresentable {
    /// Called once the hosting view (and its display layer) exists, so the caller can
    /// wire the renderer + PiP controller to the concrete layer.
    let onViewReady: (AvatarSampleBufferUIView) -> Void

    func makeUIView(context: Context) -> AvatarSampleBufferUIView {
        let view = AvatarSampleBufferUIView()
        onViewReady(view)
        return view
    }

    func updateUIView(_ uiView: AvatarSampleBufferUIView, context: Context) {}
}
