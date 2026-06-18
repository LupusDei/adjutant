import Foundation

/// Builds the public, no-API-key URL for a published proposal (adj-200, Path D / US4).
///
/// The active server `baseURL` ends in `/api` (e.g. `https://host/api`). The public
/// page is served at the server origin with `/api` stripped:
///
///     publicProposalURL(base: "https://host/api", token: "abc") == https://host/p/abc
///
/// The transform is intentionally conservative:
/// - trailing slashes are tolerated (`/api/` and bare `/`),
/// - a single trailing `/api` path segment is removed (an `api` substring elsewhere in
///   the host, e.g. `api.example.com`, is preserved),
/// - the token is percent-encoded for path safety.
///
/// - Parameters:
///   - base: The active server base URL (typically `ServerProfileStore.shared.active?.baseURL`).
///   - token: The proposal's `shareToken`.
/// - Returns: The public proposal `URL`, or `nil` when `base`/`token` is empty or the
///   resulting string is not a valid URL.
public func publicProposalURL(base: String, token: String) -> URL? {
    let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedToken.isEmpty else { return nil }

    var origin = base.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !origin.isEmpty else { return nil }

    // Drop any trailing slashes before inspecting the path tail.
    while origin.hasSuffix("/") { origin.removeLast() }

    // Strip a single trailing `/api` path segment (not an `api` substring of the host).
    if origin.hasSuffix("/api") {
        origin.removeLast("/api".count)
        // A base that was exactly "scheme://host/api/" could now end in a slash again.
        while origin.hasSuffix("/") { origin.removeLast() }
    }

    guard !origin.isEmpty else { return nil }

    let encodedToken = trimmedToken
        .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? trimmedToken
    return URL(string: "\(origin)/p/\(encodedToken)")
}
