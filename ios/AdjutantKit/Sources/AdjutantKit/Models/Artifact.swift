import Foundation

/// A global/personal **Artifact** — a self-contained, standalone HTML page decoupled
/// from proposals and beads (epic adj-j7az6). One fleet-wide library owned by the
/// Commander; there is NO project scoping.
///
/// Field shapes mirror the backend `Artifact` type (`backend/src/types/artifacts.ts`,
/// camelCased at the `rowToArtifact` boundary). Optional fields are decode-safe so an
/// unpublished / minimal row decodes without failure.
public struct Artifact: Codable, Identifiable, Equatable, Sendable {
    /// Unique identifier (UUID).
    public let id: String
    /// Human-readable title.
    public let title: String
    /// Optional URL/download-friendly slug (drives the download filename server-side).
    public let slug: String?
    /// Optional summary.
    public let description: String?
    /// Self-contained HTML body (authored source; sanitized at compose time by the server).
    public let html: String
    /// Whether the artifact is currently published (reachable via the public `/a/:token` route).
    /// Decode-safe optional — treat nil as not-published.
    public let isPublic: Bool?
    /// Unguessable base62 handle for the public route; nil until the first publish.
    /// Retained across unpublish so a re-publish revives the same link.
    public let shareToken: String?
    /// ISO 8601 timestamp of first publish (nil while private / never published).
    public let publishedAt: String?
    /// Agent id or user who authored the artifact; nil if unknown.
    public let createdBy: String?
    /// ISO 8601 creation timestamp.
    public let createdAt: String
    /// ISO 8601 last-update timestamp.
    public let updatedAt: String

    public init(
        id: String,
        title: String,
        slug: String? = nil,
        description: String? = nil,
        html: String,
        isPublic: Bool? = nil,
        shareToken: String? = nil,
        publishedAt: String? = nil,
        createdBy: String? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.title = title
        self.slug = slug
        self.description = description
        self.html = html
        self.isPublic = isPublic
        self.shareToken = shareToken
        self.publishedAt = publishedAt
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    /// Convenience: true only when the artifact is currently published.
    /// Normalizes the decode-safe optional `isPublic` (nil → false).
    public var isPublished: Bool { isPublic ?? false }

    // Shared date formatters (avoid per-call allocation — adj-6yp4.1)
    private static let isoFormatterFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoFormatterBasic = ISO8601DateFormatter()
    private static let relativeDateFormatter: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f
    }()

    /// Parse the createdAt timestamp into a Date.
    public var createdDate: Date? {
        Self.isoFormatterFractional.date(from: createdAt)
            ?? Self.isoFormatterBasic.date(from: createdAt)
    }

    /// Display-friendly relative date string.
    public var relativeDate: String {
        guard let date = createdDate else { return createdAt }
        return Self.relativeDateFormatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Request / response envelopes

/// Request body for `POST /api/artifacts`.
public struct CreateArtifactRequest: Encodable, Sendable {
    public let title: String
    public let html: String
    public let description: String?
    public let slug: String?

    public init(title: String, html: String, description: String? = nil, slug: String? = nil) {
        self.title = title
        self.html = html
        self.description = description
        self.slug = slug
    }
}

/// Decoded `data` envelope for `POST /api/artifacts/:id/publish` → `{ artifact, publicUrl }`.
struct PublishArtifactResponse: Decodable {
    let artifact: Artifact
    let publicUrl: String
}

/// Decoded `data` envelope for `POST /api/artifacts/:id/unpublish` → `{ artifact }`.
struct UnpublishArtifactResponse: Decodable {
    let artifact: Artifact
}

/// Public result of publishing an artifact: the updated artifact plus its public URL.
public struct PublishArtifactResult: Equatable, Sendable {
    /// The updated artifact (now `isPublic == true`).
    public let artifact: Artifact
    /// The full, no-API-key public URL (`<origin>/a/<shareToken>`).
    public let publicUrl: String

    public init(artifact: Artifact, publicUrl: String) {
        self.artifact = artifact
        self.publicUrl = publicUrl
    }
}
