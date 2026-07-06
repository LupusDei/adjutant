import Foundation
import Combine

/// Staged image attachments for the chat composer (adj-203.5.2).
///
/// A small observable store the composer binds to: add via PhotosPicker / paste,
/// preview thumbnails, remove before send, and clear after a successful send.
/// Enforces the per-message cap of ``maxCount`` images (matches the backend cap).
@MainActor
final class ComposerAttachments: ObservableObject {
    /// Per-message attachment cap — mirrors the backend `MAX_ATTACHMENTS_PER_MESSAGE`.
    static let maxCount = 4

    @Published private(set) var items: [PendingAttachment] = []

    init() {}

    var isEmpty: Bool { items.isEmpty }
    var count: Int { items.count }

    /// Whether another image can be staged (under the per-message cap).
    var canAddMore: Bool { items.count < Self.maxCount }

    /// Stage an image. Returns `false` (and stages nothing) if the cap is reached.
    @discardableResult
    func add(_ attachment: PendingAttachment) -> Bool {
        guard canAddMore else { return false }
        items.append(attachment)
        return true
    }

    /// Remove a staged image by id.
    func remove(id: UUID) {
        items.removeAll { $0.id == id }
    }

    /// Remove all staged images (after a successful send, or on cancel).
    func clear() {
        items.removeAll()
    }
}
