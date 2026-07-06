import Foundation

/// An image the operator has staged in the composer but not yet uploaded (adj-203.5.2).
///
/// Holds the raw bytes so send can upload it (`POST /api/uploads`) then post the
/// message with the resulting attachment id.
struct PendingAttachment: Identifiable, Equatable, Sendable {
    let id: UUID
    /// Raw image bytes to upload.
    let data: Data
    /// Filename sent to the server (server generates the stored name).
    let filename: String
    /// Image MIME type (image/png, image/jpeg, …).
    let mimeType: String

    init(id: UUID = UUID(), data: Data, filename: String, mimeType: String) {
        self.id = id
        self.data = data
        self.filename = filename
        self.mimeType = mimeType
    }
}
