import Foundation

/// Protocol for terminal API operations.
/// Enables dependency injection and testing for components that need terminal data.
public protocol TerminalAPIProviding: Sendable {
    /// Fetches terminal content for a polecat
    /// - Parameters:
    ///   - rig: The rig identifier
    ///   - polecat: The polecat name
    /// - Returns: A `TerminalCapture` containing the terminal content
    func getPolecatTerminal(rig: String, polecat: String) async throws -> TerminalCapture
}

// MARK: - APIClient Conformance

extension APIClient: TerminalAPIProviding {}
