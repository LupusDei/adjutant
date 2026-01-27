import Foundation

// MARK: - Convoys API Protocol

/// Protocol for convoy-related API operations.
/// Enables dependency injection and testing for components that need convoy data.
public protocol ConvoysAPIProviding: Sendable {
    /// Fetches all active convoys
    /// - Returns: Array of ``Convoy`` objects
    func getConvoys() async throws -> [Convoy]
}

// MARK: - Crew API Protocol

/// Protocol for crew/agent-related API operations.
/// Enables dependency injection and testing for components that need agent data.
public protocol CrewAPIProviding: Sendable {
    /// Fetches all agents as crew members
    /// - Returns: Array of ``CrewMember`` objects
    func getAgents() async throws -> [CrewMember]
}

// MARK: - Mail API Protocol

/// Protocol for mail-related API operations.
/// Enables dependency injection and testing for components that need mail data.
public protocol MailAPIProviding: Sendable {
    /// Retrieves mail messages from the inbox
    /// - Parameters:
    ///   - filter: Optional filter for message category
    ///   - all: If true, retrieves all messages instead of recent only
    /// - Returns: Paginated response containing messages
    func getMail(filter: APIClient.MailFilter?, all: Bool) async throws -> PaginatedResponse<Message>

    /// Gets a single message by ID
    /// - Parameter id: The message ID
    /// - Returns: The requested ``Message``
    func getMessage(id: String) async throws -> Message

    /// Marks a message as read
    /// - Parameter id: The message ID
    /// - Returns: Success response
    func markMessageAsRead(id: String) async throws -> SuccessResponse

    /// Synthesizes text to speech
    /// - Parameter request: The synthesis request
    /// - Returns: Synthesis response with audio file info
    func synthesizeSpeech(_ request: SynthesizeRequest) async throws -> SynthesizeResponse
}

// MARK: - APIClient Conformances

extension APIClient: ConvoysAPIProviding {}
extension APIClient: CrewAPIProviding {}
extension APIClient: MailAPIProviding {}
