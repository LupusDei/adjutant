import Foundation
import Combine
import AdjutantKit
#if canImport(UIKit)
import UIKit
#endif

/// ViewModel for the crew member detail view.
/// Handles terminal content loading and polling for polecats.
@MainActor
final class CrewDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The crew member being displayed
    @Published private(set) var member: CrewMember

    /// Terminal content (for polecats)
    @Published private(set) var terminalContent: String?

    /// Terminal session name
    @Published private(set) var terminalSessionName: String?

    /// Terminal capture timestamp
    @Published private(set) var terminalTimestamp: Date?

    /// Whether terminal is loading
    @Published private(set) var isLoadingTerminal = false

    /// Whether auto-scroll is enabled
    @Published var autoScrollEnabled = true

    /// Copy confirmation state
    @Published private(set) var showCopyConfirmation = false

    // MARK: - Private Properties

    private let apiClient: APIClient
    private var pollingTask: Task<Void, Never>?
    private let pollingInterval: TimeInterval = 5.0

    // MARK: - Initialization

    init(member: CrewMember, apiClient: APIClient? = nil) {
        self.member = member
        self.apiClient = apiClient ?? APIClient()
        super.init()
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Lifecycle

    override func onAppear() {
        super.onAppear()
        if member.type == .polecat {
            startPolling()
        }
    }

    override func onDisappear() {
        super.onDisappear()
        pollingTask?.cancel()
        pollingTask = nil
    }

    // MARK: - Data Loading

    override func refresh() async {
        if member.type == .polecat {
            await loadTerminal()
        }
    }

    /// Loads terminal content for a polecat
    func loadTerminal() async {
        guard member.type == .polecat,
              let rig = member.rig else { return }

        isLoadingTerminal = true
        errorMessage = nil

        do {
            let capture = try await apiClient.getPolecatTerminal(rig: rig, polecat: member.name)
            terminalContent = capture.content
            terminalSessionName = capture.sessionName
            terminalTimestamp = ISO8601DateFormatter().date(from: capture.timestamp)
            isLoadingTerminal = false
        } catch {
            isLoadingTerminal = false
            if terminalContent == nil {
                // Only show error if we don't have any content
                handleError(error)
            }
        }
    }

    /// Manually refresh terminal content
    func refreshTerminal() async {
        await loadTerminal()
    }

    // MARK: - Actions

    /// Copies terminal content to clipboard
    func copyTerminalContent() {
        guard let content = terminalContent else { return }

        #if canImport(UIKit)
        UIPasteboard.general.string = stripAnsiCodes(content)

        // Show confirmation
        showCopyConfirmation = true

        // Hide after delay
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            showCopyConfirmation = false
        }
        #endif
    }

    // MARK: - Polling

    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            // Initial load
            await loadTerminal()

            // Poll for updates
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollingInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await loadTerminal()
            }
        }
    }

    // MARK: - Computed Properties

    /// Whether this is a polecat (has terminal view)
    var hasTerm: Bool {
        member.type == .polecat
    }

    /// Status display text
    var statusDisplayText: String {
        switch member.status {
        case .idle: return "IDLE"
        case .working: return "WORKING"
        case .blocked: return "BLOCKED"
        case .stuck: return "STUCK"
        case .offline: return "OFFLINE"
        }
    }

    /// Formatted timestamp string
    var formattedTimestamp: String {
        guard let timestamp = terminalTimestamp else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: timestamp)
    }

    // MARK: - Helpers

    /// Strips ANSI escape codes from terminal output for clipboard
    private func stripAnsiCodes(_ text: String) -> String {
        // Pattern matches ANSI escape sequences
        let pattern = "\\x1B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return text
        }
        let range = NSRange(text.startIndex..., in: text)
        return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: "")
    }
}
