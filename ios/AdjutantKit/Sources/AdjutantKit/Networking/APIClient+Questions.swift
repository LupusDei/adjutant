import Foundation

// MARK: - Questions Endpoints (adj-181.5.2)

/// Request body for `POST /api/questions/:id/answer`.
///
/// At least one of `answerBody` / `chosenOption` must be non-nil — the backend
/// enforces this with a 400 response. The client does not pre-validate because
/// the backend is the source of truth.
private struct AnswerQuestionRequest: Encodable {
    let answerBody: String?
    let chosenOption: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // Only include keys that have values so the JSON omits null fields
        // rather than sending `"answerBody": null` — the backend accepts either
        // form but omitting absent fields is cleaner.
        if let answerBody {
            try container.encode(answerBody, forKey: .answerBody)
        }
        if let chosenOption {
            try container.encode(chosenOption, forKey: .chosenOption)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case answerBody
        case chosenOption
    }
}

/// Response payload for answer/dismiss (adj-181.22 fix).
///
/// The backend returns the updated record wrapped as `data = { question: AgentQuestion }`
/// — NOT `{ success: true }`. Decoding the wrong shape threw AFTER the backend had
/// already processed the answer/dismiss, so callers' success branch (e.g. removing the
/// row from the open list) never ran — the question appeared to "do nothing".
private struct QuestionEnvelope: Decodable {
    let question: AgentQuestion
}

/// Envelope `data` shape for `GET /api/questions` (adj-181.20 fix).
///
/// The backend returns `data = { questions: [AgentQuestion], total: Int }` —
/// NOT a bare array. Decoding `data` directly as `[AgentQuestion]` throws, which
/// (because callers treat questions as best-effort) silently yields an empty list
/// — e.g. the Overview banner never appearing. Decode the real shape and unwrap.
private struct QuestionListEnvelope: Decodable {
    let questions: [AgentQuestion]
    let total: Int
}

extension APIClient {
    /// Fetch agent questions, optionally filtered.
    ///
    /// Maps to `GET /api/questions?status=&projectId=&category=&agentId=&urgency=`
    /// → `data` = `{ questions: [AgentQuestion], total: Int }` inside the success
    /// envelope. We decode that wrapper and return `.questions`.
    ///
    /// Backend default: `status=open`, sorted blocking→high→normal→low then
    /// oldest-first. All filters are optional and composable.
    ///
    /// - Parameters:
    ///   - status:    Filter by lifecycle status. Nil uses server default (`open`).
    ///   - projectId: Scope to a specific project UUID.
    ///   - category:  Filter by question category.
    ///   - agentId:   Filter by the asking agent.
    ///   - urgency:   Filter by urgency level.
    /// - Returns: Array of matching ``AgentQuestion`` records.
    /// - Throws: ``APIClientError`` on network or server failure.
    public func listQuestions(
        status: QuestionStatus? = nil,
        projectId: String? = nil,
        category: QuestionCategory? = nil,
        agentId: String? = nil,
        urgency: QuestionUrgency? = nil
    ) async throws -> [AgentQuestion] {
        var queryItems: [URLQueryItem] = []
        if let status {
            queryItems.append(URLQueryItem(name: "status", value: status.rawValue))
        }
        if let projectId {
            queryItems.append(URLQueryItem(name: "projectId", value: projectId))
        }
        if let category {
            queryItems.append(URLQueryItem(name: "category", value: category.rawValue))
        }
        if let agentId {
            queryItems.append(URLQueryItem(name: "agentId", value: agentId))
        }
        if let urgency {
            queryItems.append(URLQueryItem(name: "urgency", value: urgency.rawValue))
        }
        let envelope: QuestionListEnvelope = try await requestWithEnvelope(
            .get,
            path: "/questions",
            queryItems: queryItems.isEmpty ? nil : queryItems
        )
        return envelope.questions
    }

    /// Answer an open question.
    ///
    /// Maps to `POST /api/questions/:id/answer { answerBody?, chosenOption? }`.
    /// At least one of `answerBody` / `chosenOption` must be supplied (the backend
    /// returns 400 if both are absent). If `chosenOption` is given it MUST be
    /// one of the question's `suggestedOptions` (also enforced by the backend).
    ///
    /// On success the question moves to `status = "answered"`, the asking agent
    /// receives the answer in its DM, and the WS broadcasts `question:answered`.
    ///
    /// - Parameters:
    ///   - questionId:   The ID of the question to answer.
    ///   - answerBody:   Optional free-text answer.
    ///   - chosenOption: Optional suggested option the General picked.
    /// - Throws: ``APIClientError`` on network / server failure (400, 404, etc.).
    public func answerQuestion(
        questionId: String,
        answerBody: String? = nil,
        chosenOption: String? = nil
    ) async throws {
        let encodedId = questionId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? questionId
        let _: QuestionEnvelope = try await requestWithEnvelope(
            .post,
            path: "/questions/\(encodedId)/answer",
            body: AnswerQuestionRequest(answerBody: answerBody, chosenOption: chosenOption)
        )
    }

    /// Dismiss an open question.
    ///
    /// Maps to `POST /api/questions/:id/dismiss` → `{ success: true }`.
    /// Sets status to `"dismissed"` and broadcasts `question:dismissed` over WS.
    ///
    /// - Parameter questionId: The ID of the question to dismiss.
    /// - Throws: ``APIClientError`` on network / server failure (404, etc.).
    public func dismissQuestion(questionId: String) async throws {
        let encodedId = questionId
            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? questionId
        let _: QuestionEnvelope = try await requestWithEnvelope(
            .post,
            path: "/questions/\(encodedId)/dismiss"
        )
    }
}
