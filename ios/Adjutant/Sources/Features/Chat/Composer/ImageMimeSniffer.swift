import Foundation

/// Detects an image MIME type from raw bytes (magic-byte sniff) so the composer
/// can label a picked/pasted image correctly for `POST /api/uploads` (adj-203).
/// The backend independently validates the magic bytes; this just picks a
/// sensible `Content-Type` for the multipart part.
enum ImageMimeSniffer {
    /// Returns an allowed image MIME (`image/png|jpeg|gif|webp`) or nil if the
    /// bytes don't match a supported image signature.
    static func mimeType(for data: Data) -> String? {
        let bytes = [UInt8](data.prefix(16))
        guard bytes.count >= 4 else { return nil }

        // PNG: 89 50 4E 47
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        // JPEG: FF D8 FF
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        // GIF: 47 49 46 38 ("GIF8")
        if bytes.starts(with: [0x47, 0x49, 0x46, 0x38]) { return "image/gif" }
        // WEBP: "RIFF" .... "WEBP"
        if bytes.count >= 12,
           bytes.starts(with: [0x52, 0x49, 0x46, 0x46]),
           Array(bytes[8..<12]) == [0x57, 0x45, 0x42, 0x50] {
            return "image/webp"
        }
        return nil
    }

    /// A default filename+extension for the given MIME.
    static func filename(for mimeType: String) -> String {
        switch mimeType {
        case "image/png": return "image.png"
        case "image/jpeg": return "image.jpg"
        case "image/gif": return "image.gif"
        case "image/webp": return "image.webp"
        default: return "image"
        }
    }
}
