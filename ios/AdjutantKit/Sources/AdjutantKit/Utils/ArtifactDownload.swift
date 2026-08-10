import Foundation

/// Download/save helpers for Artifacts (epic adj-j7az6, Phase 4 / US4 — .4.4).
///
/// This is the CRITICAL mobile download requirement: produce a filesystem-safe
/// `<title>.html` filename and write the composed, self-contained document to a file the
/// iOS share sheet / Files app can save. Pure, injectable logic so it is unit-testable
/// on-host without an app / WKWebView.

/// Derive a filesystem-safe download filename for an artifact.
///
/// Prefers an explicit `slug`, else slugifies the `title`; on an empty/all-unsafe source
/// falls back to `artifact-<id>.html` (so the file always has a sensible, safe name with
/// no path-traversal / header-injection characters).
///
/// - Parameters:
///   - title: The artifact title (may be empty).
///   - slug: Optional explicit slug; used verbatim-slugified when non-blank.
///   - id: The artifact id, used for the fallback filename.
/// - Returns: A safe `<slug>.html` filename, or `artifact-<id>.html`.
public func artifactDownloadFilename(title: String, slug: String? = nil, id: String) -> String {
    let sourceCandidates = [slug, title]
    for candidate in sourceCandidates {
        guard let candidate else { continue }
        let s = slugify(candidate)
        if !s.isEmpty { return "\(s).html" }
    }
    return "artifact-\(id).html"
}

/// Convenience overload: derive the download filename directly from an ``Artifact``.
public func artifactDownloadFilename(for artifact: Artifact) -> String {
    artifactDownloadFilename(title: artifact.title, slug: artifact.slug, id: artifact.id)
}

/// Lowercase, replace any run of non-alphanumeric characters with a single `-`, trim
/// leading/trailing `-`, and cap at 80 characters. Mirrors the backend `artifactFilename`
/// slug rule so web and iOS downloads name the same artifact identically.
private func slugify(_ input: String) -> String {
    let lowered = input.lowercased()
    var result = ""
    var lastWasDash = false
    for scalar in lowered.unicodeScalars {
        let isAlnum = (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9")
        if isAlnum {
            result.unicodeScalars.append(scalar)
            lastWasDash = false
        } else if !lastWasDash {
            result.append("-")
            lastWasDash = true
        }
    }
    // Trim leading/trailing dashes.
    while result.hasPrefix("-") { result.removeFirst() }
    while result.hasSuffix("-") { result.removeLast() }
    if result.count > 80 {
        result = String(result.prefix(80))
        while result.hasSuffix("-") { result.removeLast() }
    }
    return result
}

/// Write the composed artifact document to a file and return its URL — ready to hand to a
/// `UIActivityViewController` (share sheet → "Save to Files").
///
/// - Parameters:
///   - html: The composed, self-contained HTML document.
///   - filename: The safe filename (see ``artifactDownloadFilename(title:slug:id:)``).
///   - directory: Destination directory. Defaults to a per-run temporary subdirectory. The
///     directory is created if it does not exist; an existing file is overwritten.
/// - Returns: The file URL of the written document.
/// - Throws: Any `FileManager` / write error.
@discardableResult
public func writeArtifactDocument(
    _ html: String,
    filename: String,
    directory: URL? = nil
) throws -> URL {
    let dir = directory ?? FileManager.default.temporaryDirectory
        .appendingPathComponent("adjutant-artifacts", isDirectory: true)

    if !FileManager.default.fileExists(atPath: dir.path) {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    let fileURL = dir.appendingPathComponent(filename)
    try html.data(using: .utf8)?.write(to: fileURL, options: .atomic)
    return fileURL
}
