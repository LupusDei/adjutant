import Foundation
import UIKit

/// Normalizes picked/pasted image bytes to a type the backend accepts (adj-203.5.5).
///
/// The upload allowlist is png/jpeg/gif/webp. The photo library commonly hands
/// back **HEIC**, which is not on the allowlist — without conversion those picks
/// were silently dropped. This converts any decodable-but-not-allowlisted image
/// (HEIC, TIFF, BMP, …) to JPEG so the Commander can send any photo/screenshot.
enum ImageConverter {
    /// MIME types the backend accepts directly (no conversion needed).
    static let allowedMimeTypes: Set<String> = ["image/png", "image/jpeg", "image/gif", "image/webp"]

    /// Returns allowlist-safe image data + its MIME.
    ///
    /// - If the input already sniffs as an allowlisted image, it is returned
    ///   unchanged (no re-encode — preserves animated GIFs / WEBP).
    /// - Otherwise the bytes are decoded and re-encoded as JPEG.
    /// - Returns `nil` only when the bytes are not a decodable image (the caller
    ///   surfaces clear feedback rather than dropping silently).
    static func normalizedImageData(from data: Data, jpegQuality: CGFloat = 0.9) -> (data: Data, mimeType: String)? {
        // Fast path: already an allowed type — do not re-encode.
        if let mime = ImageMimeSniffer.mimeType(for: data) {
            return (data, mime)
        }
        // Convert anything else decodable (e.g. HEIC) to JPEG.
        guard let image = UIImage(data: data),
              let jpeg = image.jpegData(compressionQuality: jpegQuality) else {
            return nil
        }
        return (jpeg, "image/jpeg")
    }
}
