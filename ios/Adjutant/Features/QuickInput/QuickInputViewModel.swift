import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Quick Input FAB feature.
/// Manages message composition and sending.
@MainActor
final class QuickInputViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// Message body text
    @Published var messageBody: String = ""

    /// Current sending state
    @Published private(set) var sendState: SendState = .idle

    /// User's mail identity (FROM badge)
    @Published private(set) var identity: String = "USER"

    /// Whether voice recording is in progress
    @Published private(set) var isRecording: Bool = false

    /// Whether the expanded form is shown
    @Published var isExpanded: Bool = false

    // MARK: - Types

    enum SendState: Equatable {
        case idle
        case sending
        case success
        case error(String)

        var isSuccess: Bool {
            if case .success = self { return true }
            return false
        }

        var isError: Bool {
            if case .error = self { return true }
            return false
        }
    }

    // MARK: - Computed Properties

    /// Whether voice input is available
    var isVoiceAvailable: Bool {
        AppState.shared.isVoiceAvailable
    }

    /// Whether the send button should be enabled
    var canSend: Bool {
        !messageBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        sendState != .sending
    }

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        Task {
            await fetchIdentity()
        }
    }

    // MARK: - Actions

    /// Sends the message via chat API
    func sendMessage() async {
        guard canSend else { return }

        sendState = .sending

        do {
            _ = try await apiClient.sendChatMessage(
                agentId: "user",
                body: messageBody.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            sendState = .success

            // Auto-collapse after success with delay
            try? await Task.sleep(nanoseconds: 1_500_000_000) // 1.5 seconds
            if sendState.isSuccess {
                messageBody = ""
                isExpanded = false
                sendState = .idle
            }
        } catch let error as APIClientError {
            sendState = .error(error.localizedDescription)
        } catch {
            sendState = .error("Failed to send message")
        }
    }

    /// Toggles voice recording
    func toggleRecording() {
        guard isVoiceAvailable else { return }
        isRecording.toggle()
        // Voice recording implementation would go here
        // For now, just toggle the state
    }

    /// Resets the send state after showing error
    func dismissError() {
        if case .error = sendState {
            sendState = .idle
        }
    }

    /// Closes the expanded form
    func close() {
        isExpanded = false
        sendState = .idle
    }

    // MARK: - Private Methods

    private func fetchIdentity() async {
        // Mail identity API removed; use default
        identity = "USER"
    }
}
