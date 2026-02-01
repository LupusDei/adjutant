import Foundation

/// Utility for humanizing announcement text for voice synthesis.
/// Removes bead IDs, shortens titles, and formats status changes into natural speech.
public struct AnnouncementTextFormatter {

    // MARK: - Constants

    /// Maximum length for announcement text
    private static let maxTitleLength = 80

    /// Regex pattern for bead IDs (e.g., "hq-abc123:", "hq-abc123.1:")
    private static let beadIdPattern = #"^hq-[a-z0-9]+(\.[0-9]+)?:\s*"#

    /// Words to remove from titles for conciseness
    private static let fillerWords = ["the", "a", "an", "to", "for", "in", "on", "with", "that", "this"]

    // MARK: - Title Formatting

    /// Formats a bead title for voice announcement.
    /// Removes bead ID prefixes, truncates long titles, and cleans up technical jargon.
    /// - Parameter title: The original bead title
    /// - Returns: A humanized title suitable for speech
    public static func formatBeadTitle(_ title: String) -> String {
        var result = title

        // Remove bead ID prefix (e.g., "hq-abc123: Title" -> "Title")
        if let regex = try? NSRegularExpression(pattern: beadIdPattern, options: .caseInsensitive) {
            let range = NSRange(result.startIndex..., in: result)
            result = regex.stringByReplacingMatches(in: result, options: [], range: range, withTemplate: "")
        }

        // Trim whitespace
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)

        // Truncate if too long, preserving word boundaries
        if result.count > maxTitleLength {
            result = truncatePreservingWords(result, maxLength: maxTitleLength)
        }

        return result
    }

    // MARK: - Status Change Formatting

    /// Formats a bead status change into a natural speech announcement.
    /// - Parameters:
    ///   - title: The bead title (will be formatted)
    ///   - oldStatus: The previous status (optional)
    ///   - newStatus: The new status
    /// - Returns: A natural language announcement
    public static func formatStatusChange(title: String, oldStatus: String?, newStatus: String) -> String {
        let cleanTitle = formatBeadTitle(title)

        switch newStatus.lowercased() {
        case "hooked":
            return "New task hooked: \(cleanTitle)"
        case "in_progress":
            return "Starting work on: \(cleanTitle)"
        case "closed", "completed", "done":
            return "Task completed: \(cleanTitle)"
        case "blocked":
            return "Task blocked: \(cleanTitle)"
        case "open":
            if oldStatus?.lowercased() == "closed" {
                return "Task reopened: \(cleanTitle)"
            }
            return "Task available: \(cleanTitle)"
        default:
            return "Task updated: \(cleanTitle)"
        }
    }

    // MARK: - Mail Formatting

    /// Formats a mail announcement for voice synthesis.
    /// - Parameters:
    ///   - from: The sender's identifier (will be humanized)
    ///   - subject: The mail subject (will be truncated if needed)
    /// - Returns: A natural language mail announcement
    public static func formatMailAnnouncement(from: String, subject: String) -> String {
        let humanizedSender = humanizeSender(from)
        let cleanSubject = truncatePreservingWords(subject, maxLength: 60)

        return "New mail from \(humanizedSender): \(cleanSubject)"
    }

    /// Formats a detailed mail announcement including body preview.
    /// - Parameters:
    ///   - from: The sender's identifier
    ///   - subject: The mail subject
    ///   - bodyPreview: Optional body preview text
    /// - Returns: A natural language mail announcement with preview
    public static func formatMailAnnouncementWithPreview(from: String, subject: String, bodyPreview: String?) -> String {
        let base = formatMailAnnouncement(from: from, subject: subject)

        guard let preview = bodyPreview, !preview.isEmpty else {
            return base
        }

        let cleanPreview = truncatePreservingWords(preview, maxLength: 100)
        return "\(base). \(cleanPreview)"
    }

    // MARK: - Private Helpers

    /// Truncates text to a maximum length, preserving word boundaries.
    /// - Parameters:
    ///   - text: The text to truncate
    ///   - maxLength: Maximum allowed length
    /// - Returns: Truncated text with ellipsis if shortened
    private static func truncatePreservingWords(_ text: String, maxLength: Int) -> String {
        guard text.count > maxLength else { return text }

        let truncated = String(text.prefix(maxLength))

        // Find the last space to avoid cutting mid-word
        if let lastSpace = truncated.lastIndex(of: " ") {
            return String(truncated[..<lastSpace])
        }

        return truncated
    }

    /// Humanizes a sender identifier for voice synthesis.
    /// Converts paths like "adjutant/polecats/jasper" to "polecat jasper"
    /// - Parameter sender: The sender identifier
    /// - Returns: A human-friendly sender name
    private static func humanizeSender(_ sender: String) -> String {
        let components = sender.split(separator: "/")

        // Handle polecat paths: "rig/polecats/name" -> "polecat name"
        if components.count >= 3 && components[1] == "polecats" {
            return "polecat \(components[2])"
        }

        // Handle crew paths: "rig/crew/name" -> "crew name"
        if components.count >= 3 && components[1] == "crew" {
            return "crew \(components[2])"
        }

        // Handle simple names
        if let lastComponent = components.last {
            return String(lastComponent)
        }

        return sender
    }
}
