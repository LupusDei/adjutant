import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Open Questions triage screen (adj-181.5 / US4).
///
/// Loads all open questions via `GET /api/questions`, keeps the list sorted
/// (blocking→high→normal→low, then oldest-first within a tier), supports
/// live WebSocket updates (`question:new`, `question:answered`,
/// `question:dismissed`), composable category/agent/urgency filters,
/// and answer/dismiss operations.
///
/// **Architecture**: pure `@MainActor` ViewModel; the view observes published
/// state and calls mutating methods. No direct DB access — all I/O through
/// `APIClient`. WS integration via `handleQuestionNew/Answered/Dismissed`
/// called by the hosting view's `WebSocketClient` observer.
@MainActor
final class OpenQuestionsViewModel: BaseViewModel {
    // MARK: - Published State

    /// All currently-open questions, sorted blocking→high→normal→low, oldest-first.
    @Published private(set) var questions: [AgentQuestion] = []

    // MARK: - Filter State

    /// When set, `filteredQuestions` only returns questions of this category.
    @Published var filterCategory: QuestionCategory?

    /// When set, `filteredQuestions` only returns questions from this agent.
    @Published var filterAgentId: String?

    /// When set, `filteredQuestions` only returns questions at this urgency.
    @Published var filterUrgency: QuestionUrgency?

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Init

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        Task<Void, Never> {
            await loadQuestions()
        }
    }

    // MARK: - Data Loading

    /// Fetch open questions from the backend and replace the current list.
    ///
    /// Uses server default `status=open` (no status filter passed) so the
    /// backend's own sorting guarantee is primary; we re-sort locally for
    /// robustness (mirrors web hook behaviour).
    func loadQuestions() async {
        await performAsyncAction(showLoading: questions.isEmpty) {
            let raw = try await self.apiClient.listQuestions()
            self.questions = Self.sorted(raw)
        }
    }

    // MARK: - Computed

    /// The filtered subset of `questions`, respecting all active filters.
    /// Order is preserved from `questions` (already sorted).
    var filteredQuestions: [AgentQuestion] {
        questions.filter { q in
            if let cat = filterCategory, q.category != cat { return false }
            if let agent = filterAgentId, q.agentId != agent { return false }
            if let urg = filterUrgency, q.urgency != urg { return false }
            return true
        }
    }

    // MARK: - Answer

    /// Answer an open question with a chosen option and/or free-text body.
    ///
    /// On success the question is removed from `questions` optimistically
    /// (it is no longer open). On failure the question stays and `errorMessage`
    /// is set.
    ///
    /// - Parameters:
    ///   - questionId:   The question to answer.
    ///   - answerBody:   Optional free-text answer.
    ///   - chosenOption: Optional suggested option chosen by the General.
    func answer(
        questionId: String,
        answerBody: String? = nil,
        chosenOption: String? = nil
    ) async {
        await performAsyncAction(showLoading: false) {
            try await self.apiClient.answerQuestion(
                questionId: questionId,
                answerBody: answerBody,
                chosenOption: chosenOption
            )
            self.removeQuestion(id: questionId)
        }
    }

    // MARK: - Dismiss

    /// Dismiss an open question.
    ///
    /// On success the question is removed from `questions`. On failure
    /// the question stays and `errorMessage` is set.
    func dismiss(questionId: String) async {
        await performAsyncAction(showLoading: false) {
            try await self.apiClient.dismissQuestion(questionId: questionId)
            self.removeQuestion(id: questionId)
        }
    }

    // MARK: - Live WS Event Handlers

    /// Called when the WebSocket receives a `question:new` event.
    ///
    /// Adds the question to the sorted list, skipping duplicates (can happen
    /// if the client reconnects and the server replays events).
    func handleQuestionNew(_ question: AgentQuestion) {
        guard !questions.contains(where: { $0.id == question.id }) else { return }
        questions.append(question)
        questions = Self.sorted(questions)
    }

    /// Called when the WebSocket receives a `question:answered` event.
    ///
    /// Removes the question from the open list regardless of who answered it —
    /// it is no longer actionable for the General.
    func handleQuestionAnswered(id: String) {
        removeQuestion(id: id)
    }

    /// Called when the WebSocket receives a `question:dismissed` event.
    func handleQuestionDismissed(id: String) {
        removeQuestion(id: id)
    }

    // MARK: - Private Helpers

    private func removeQuestion(id: String) {
        questions.removeAll { $0.id == id }
    }

    /// Sort open questions: blocking first, then high, normal, low;
    /// within each tier, oldest (createdAt ascending) first.
    ///
    /// `createdAt` is a SQLite `datetime('now')` string (`"YYYY-MM-DD HH:MM:SS"`)
    /// that sorts lexicographically. String comparison is correct here because the
    /// format is zero-padded and ISO-like; no Date parse needed.
    private static func sorted(_ questions: [AgentQuestion]) -> [AgentQuestion] {
        questions.sorted { a, b in
            if a.urgencySortOrder != b.urgencySortOrder {
                return a.urgencySortOrder < b.urgencySortOrder
            }
            return a.createdAt < b.createdAt
        }
    }
}
