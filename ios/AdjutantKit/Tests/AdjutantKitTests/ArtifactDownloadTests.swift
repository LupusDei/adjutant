import XCTest
@testable import AdjutantKit

/// Tests for the iOS artifact download/save helper (epic adj-j7az6, Phase 4 / US4 — .4.4).
///
/// This is the CRITICAL mobile download requirement: derive a safe `<title>.html` filename
/// and write the composed document to a file the share sheet / Files app can save.
final class ArtifactDownloadTests: XCTestCase {

    // MARK: - Filename slug

    func testFilenameSlugsTitle() {
        let name = artifactDownloadFilename(title: "My Launch Page", slug: nil, id: "a-001")
        XCTAssertEqual(name, "my-launch-page.html")
    }

    func testFilenamePrefersSlugOverTitle() {
        let name = artifactDownloadFilename(title: "My Launch Page", slug: "custom-slug", id: "a-001")
        XCTAssertEqual(name, "custom-slug.html")
    }

    func testFilenameStripsUnsafeCharacters() {
        let name = artifactDownloadFilename(title: "Report: Q3/Q4 (2026)!", slug: nil, id: "a-001")
        XCTAssertEqual(name, "report-q3-q4-2026.html")
    }

    func testFilenameCollapsesAndTrimsSeparators() {
        let name = artifactDownloadFilename(title: "  ---Hello   World---  ", slug: nil, id: "a-001")
        XCTAssertEqual(name, "hello-world.html")
    }

    func testFilenameFallsBackToArtifactIdWhenTitleEmpty() {
        let name = artifactDownloadFilename(title: "", slug: nil, id: "a-XYZ")
        XCTAssertEqual(name, "artifact-a-XYZ.html")
    }

    func testFilenameFallsBackWhenTitleAllUnsafe() {
        // A title that slugifies to nothing (all punctuation) → id fallback.
        let name = artifactDownloadFilename(title: "!!!///", slug: nil, id: "a-42")
        XCTAssertEqual(name, "artifact-a-42.html")
    }

    func testFilenameFallsBackWhenSlugEmptyUsesTitle() {
        let name = artifactDownloadFilename(title: "Fine Title", slug: "   ", id: "a-1")
        XCTAssertEqual(name, "fine-title.html")
    }

    func testFilenameCapsLength() {
        let longTitle = String(repeating: "a", count: 200)
        let name = artifactDownloadFilename(title: longTitle, slug: nil, id: "a-1")
        // <=80 slug chars + ".html"
        XCTAssertLessThanOrEqual(name.count, 85)
        XCTAssertTrue(name.hasSuffix(".html"))
    }

    // MARK: - File write

    func testWriteArtifactDocumentCreatesReadableFile() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("artifact-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let html = "<!DOCTYPE html><html><body><h1>Hello</h1></body></html>"
        let url = try writeArtifactDocument(html, filename: "hello.html", directory: dir)

        XCTAssertEqual(url.lastPathComponent, "hello.html")
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        let readBack = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(readBack, html)
    }

    func testWriteArtifactDocumentCreatesMissingDirectory() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("artifact-tests-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("nested", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir.deletingLastPathComponent()) }

        let url = try writeArtifactDocument("<p>x</p>", filename: "x.html", directory: dir)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    func testWriteArtifactDocumentOverwritesExisting() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("artifact-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        _ = try writeArtifactDocument("<p>old</p>", filename: "same.html", directory: dir)
        let url = try writeArtifactDocument("<p>new</p>", filename: "same.html", directory: dir)
        let readBack = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(readBack, "<p>new</p>")
    }

    // MARK: - Convenience: artifact → filename

    func testFilenameForArtifactUsesTitle() {
        let artifact = Artifact(
            id: "a-1",
            title: "Landing Page",
            html: "<main>x</main>",
            createdAt: "2026-08-10 10:00:00",
            updatedAt: "2026-08-10 10:00:00"
        )
        XCTAssertEqual(artifactDownloadFilename(for: artifact), "landing-page.html")
    }
}
