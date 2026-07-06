import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
@testable import AdjutantUI

/// Tests for `ImageConverter` (adj-203.5.5): non-allowlisted image types
/// (notably HEIC from the photo library) are converted to JPEG before upload so
/// they are not silently dropped by the backend png/jpeg/gif/webp allowlist.
final class ImageConverterTests: XCTestCase {

    /// Render a tiny solid image and encode it as HEIC via ImageIO.
    private func makeHEICData() -> Data? {
        let size = CGSize(width: 8, height: 8)
        let image = UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.systemRed.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
        }
        guard let cgImage = image.cgImage else { return nil }
        let out = NSMutableData()
        let type = (UTType.heic.identifier) as CFString
        guard let dest = CGImageDestinationCreateWithData(out, type, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cgImage, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return out as Data
    }

    func testHEICConvertsToJPEG() throws {
        guard let heic = makeHEICData(), !heic.isEmpty else {
            throw XCTSkip("HEIC encoding unavailable on this runtime")
        }
        // Precondition: HEIC is NOT in the allowlist (would be dropped without conversion).
        XCTAssertNil(ImageMimeSniffer.mimeType(for: heic), "HEIC must not sniff as an allowlisted type")

        let result = try XCTUnwrap(
            ImageConverter.normalizedImageData(from: heic),
            "HEIC should convert, not drop"
        )
        XCTAssertEqual(result.mimeType, "image/jpeg")
        // The converted bytes must themselves sniff as an allowlisted JPEG.
        XCTAssertEqual(ImageMimeSniffer.mimeType(for: result.data), "image/jpeg")
    }

    func testAllowlistedTypePassesThroughUnchanged() {
        // A PNG header — sniffer matches magic bytes, so it passes through as-is
        // without a re-encode.
        let png = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x02])
        let result = ImageConverter.normalizedImageData(from: png)
        XCTAssertEqual(result?.mimeType, "image/png")
        XCTAssertEqual(result?.data, png, "allowlisted data must not be re-encoded")
    }

    func testNonImageReturnsNil() {
        let junk = Data("this is definitely not an image".utf8)
        XCTAssertNil(ImageConverter.normalizedImageData(from: junk))
    }
}
