import Foundation

/// Result of `POST /api/uploads` — an unlinked, stored image attachment (adj-203).
///
/// Maps to the backend response `{ id, filename, mimeType, sizeBytes }`.
public struct UploadResult: Codable, Equatable, Sendable, Identifiable {
    /// Server-generated attachment id (used later as an `attachmentId` on send).
    public let id: String
    /// Original (client-supplied) filename.
    public let filename: String
    /// Validated MIME type (png/jpeg/gif/webp).
    public let mimeType: String
    /// Stored size in bytes.
    public let sizeBytes: Int

    public init(id: String, filename: String, mimeType: String, sizeBytes: Int) {
        self.id = id
        self.filename = filename
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
    }
}

/// An image attachment hydrated onto a message (adj-203).
///
/// Maps to the backend `MessageAttachment` shape. The server-only `storagePath`
/// field is intentionally omitted — the client reaches the bytes via
/// `GET /api/uploads/:id` (see ``APIClient/uploadURL(id:)`` /
/// ``APIClient/fetchUploadData(id:)``), never a filesystem path.
public struct MessageAttachment: Codable, Equatable, Sendable, Hashable, Identifiable {
    public let id: String
    /// The message this attachment is linked to (nil while unlinked).
    public let messageId: String?
    /// Attachment kind (currently always `"image"`).
    public let kind: String
    public let filename: String
    public let mimeType: String
    public let sizeBytes: Int
    public let createdAt: String

    public init(
        id: String,
        messageId: String? = nil,
        kind: String = "image",
        filename: String,
        mimeType: String,
        sizeBytes: Int,
        createdAt: String
    ) {
        self.id = id
        self.messageId = messageId
        self.kind = kind
        self.filename = filename
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.createdAt = createdAt
    }

    /// Whether this attachment is a renderable image.
    public var isImage: Bool {
        kind == "image" || mimeType.hasPrefix("image/")
    }
}
