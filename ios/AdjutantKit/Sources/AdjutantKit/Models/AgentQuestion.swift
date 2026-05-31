import Foundation

// MARK: - AgentQuestion Enums

/// Urgency level of an agent question (adj-181).
/// Mirrors backend `urgency` CHECK constraint:
/// `'low' | 'normal' | 'high' | 'blocking'`.
public enum QuestionUrgency: String, Codable, CaseIterable, Sendable {
    case low
    case normal
    case high
    case blocking
}

/// Current lifecycle status of a question (adj-181).
/// Mirrors backend `status` CHECK constraint:
/// `'open' | 'answered' | 'dismissed'`.
public enum QuestionStatus: String, Codable, CaseIterable, Sendable {
    case open
    case answered
    case dismissed
}

/// Filterable category bucket for a question (adj-181).
/// Mirrors backend `category` values:
/// `'decision' | 'clarification' | 'approval' | 'action_required' | 'other'`.
///
/// `actionRequired` means the General must **do** something (grant access,
/// add a secret, approve with a side-effect), not just answer a question.
public enum QuestionCategory: String, Codable, CaseIterable, Sendable {
    case decision
    case clarification
    case approval
    case actionRequired = "action_required"
    case other
}

// MARK: - AgentQuestion Model

/// A first-class, triageable question filed by an agent to the General (adj-181).
///
/// Mirrors the backend `agent_questions` table row as emitted by
/// `question-store.ts` → `rowToQuestion(...)`. All optional fields reflect
/// SQLite `NULL` columns; the decode must never throw on absent optional fields.
///
/// **Answer contract**: an answered question has either `chosenOption` (the
/// General picked one of `suggestedOptions`) or `answerBody` (free-text answer)
/// or both; at least one must be non-nil.
public struct AgentQuestion: Codable, Identifiable, Hashable, Sendable {
    // MARK: - Required fields

    /// Unique identifier (UUID string).
    public let id: String

    /// The project this question is scoped to (UUID — never projectName).
    public let projectId: String

    /// The agent that filed this question (server-resolved, never client-supplied).
    public let agentId: String

    /// The question body — the one-line ask.
    public let body: String

    /// Urgency level (defaults `normal` on the backend).
    public let urgency: QuestionUrgency

    /// Current lifecycle status.
    public let status: QuestionStatus

    /// ISO/SQLite timestamp of when the question was created.
    public let createdAt: String

    /// ISO/SQLite timestamp of the last update.
    public let updatedAt: String

    // MARK: - Optional fields

    /// Rich agent-authored framing: what it's doing, what it tried, the
    /// tradeoff. Helps the General answer quickly and accurately.
    public let context: String?

    /// Filterable category bucket.
    public let category: QuestionCategory?

    /// Agent-proposed answer choices the General can one-tap.
    /// Stored as a JSON array on the backend; decoded here as `[String]`.
    public let suggestedOptions: [String]?

    /// Free-text answer provided by the General (nullable until answered).
    public let answerBody: String?

    /// The chosen option from `suggestedOptions` (nullable until answered).
    public let chosenOption: String?

    /// The member id of whoever answered (typically `"user"`).
    public let answeredBy: String?

    /// Optional link to a bead this question relates to.
    public let beadId: String?

    /// The DM conversation the question was mirrored into.
    public let conversationId: String?

    /// ISO/SQLite timestamp of when the question was answered (nil while open/dismissed).
    public let answeredAt: String?

    // MARK: - Init

    public init(
        id: String,
        projectId: String,
        agentId: String,
        body: String,
        urgency: QuestionUrgency,
        status: QuestionStatus,
        createdAt: String,
        updatedAt: String,
        context: String? = nil,
        category: QuestionCategory? = nil,
        suggestedOptions: [String]? = nil,
        answerBody: String? = nil,
        chosenOption: String? = nil,
        answeredBy: String? = nil,
        beadId: String? = nil,
        conversationId: String? = nil,
        answeredAt: String? = nil
    ) {
        self.id = id
        self.projectId = projectId
        self.agentId = agentId
        self.body = body
        self.urgency = urgency
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.context = context
        self.category = category
        self.suggestedOptions = suggestedOptions
        self.answerBody = answerBody
        self.chosenOption = chosenOption
        self.answeredBy = answeredBy
        self.beadId = beadId
        self.conversationId = conversationId
        self.answeredAt = answeredAt
    }
}

// MARK: - Computed Properties

public extension AgentQuestion {
    /// Whether this question is still waiting for a response.
    var isOpen: Bool { status == .open }

    /// Display priority index for sort ordering:
    /// blocking (0) > high (1) > normal (2) > low (3).
    var urgencySortOrder: Int {
        switch urgency {
        case .blocking: return 0
        case .high:     return 1
        case .normal:   return 2
        case .low:      return 3
        }
    }
}
