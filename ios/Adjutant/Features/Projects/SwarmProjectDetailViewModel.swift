import Foundation
import Combine
import AdjutantKit

/// ViewModel for the swarm project detail view.
/// Manages sessions, swarms, and project actions.
@MainActor
final class SwarmProjectDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    @Published private(set) var project: Project
    @Published private(set) var sessions: [ManagedSession] = []
    @Published private(set) var swarms: [SwarmInfo] = []
    @Published private(set) var isCreatingSession = false
    @Published private(set) var isCreatingSwarm = false
    @Published private(set) var isDeletingProject = false
    @Published var showDeleteConfirmation = false
    @Published var autoDevelopEnabled = false
    @Published private(set) var autoDevelopStatus: AutoDevelopStatus?
    @Published private(set) var isTogglingAutoDevelop = false

    // MARK: - Style Guide (adj-201 / US4)

    /// Primary brand color hex text bound to the editor input. Empty = "clear the guide".
    @Published var styleGuidePrimary = ""
    /// Optional secondary brand color hex text bound to the editor input. Empty = no secondary.
    @Published var styleGuideSecondary = ""
    /// True while a style-guide save is in flight.
    @Published private(set) var isSavingStyleGuide = false
    /// User-facing error from the last style-guide load/save, if any.
    @Published var styleGuideError: String?
    /// Transient confirmation that the last save succeeded; reset on the next load.
    @Published private(set) var styleGuideSaved = false

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Initialization

    init(project: Project, apiClient: APIClient? = nil) {
        self.project = project
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsyncAction(showLoading: sessions.isEmpty && swarms.isEmpty) {
            async let fetchedSessions = self.apiClient.getSessions()
            async let fetchedSwarms = self.apiClient.getSwarms()

            let (allSessions, allSwarms) = try await (fetchedSessions, fetchedSwarms)

            // Filter to sessions belonging to this project
            self.sessions = allSessions.filter { $0.projectPath == self.project.path }
            self.swarms = allSwarms.filter { $0.projectPath == self.project.path }

            // Refresh the project itself
            if let updated = try? await self.apiClient.getProject(id: self.project.id) {
                self.project = updated
                self.autoDevelopEnabled = updated.autoDevelop ?? false
            }
        }

        // Fetch auto-develop status separately (non-critical)
        await fetchAutoDevelopStatus()
    }

    // MARK: - Actions

    /// Create a new swarm agent session for this project.
    /// Pass a name to choose a specific callsign; omit for random assignment.
    func createSession(name: String? = nil) async -> ManagedSession? {
        isCreatingSession = true
        defer { isCreatingSession = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.createSession(
                CreateSessionRequest(
                    name: name,
                    projectPath: self.project.path,
                    mode: "swarm"
                )
            )
        }

        if result != nil {
            await refresh()
        }
        return result
    }

    /// Create a new swarm for this project
    func createSwarm(agentCount: Int = 3) async -> SwarmInfo? {
        isCreatingSwarm = true
        defer { isCreatingSwarm = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.createSwarm(
                CreateSwarmRequest(
                    projectPath: self.project.path,
                    agentCount: agentCount
                )
            )
        }

        if result != nil {
            await refresh()
        }
        return result
    }

    /// Kill a session
    func killSession(_ session: ManagedSession) async {
        await performAsyncAction(showLoading: false) {
            _ = try await self.apiClient.killSession(id: session.id)
        }
        await refresh()
    }

    /// Delete the project registration
    func deleteProject() async -> Bool {
        isDeletingProject = true
        defer { isDeletingProject = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.deleteProject(id: self.project.id)
        }
        return result?.deleted ?? false
    }

    // MARK: - Auto-Develop

    /// Fetch the current auto-develop status for this project.
    func fetchAutoDevelopStatus() async {
        let result = await performAsync(showLoading: false) {
            try await self.apiClient.getAutoDevelopStatus(projectId: self.project.id)
        }
        if let status = result {
            self.autoDevelopStatus = status
            self.autoDevelopEnabled = status.enabled
        }
    }

    /// Toggle auto-develop on or off for this project.
    func toggleAutoDevelop() async {
        let newValue = !autoDevelopEnabled
        isTogglingAutoDevelop = true
        defer { isTogglingAutoDevelop = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.updateProjectAutoDevelop(
                projectId: self.project.id,
                autoDevelop: newValue
            )
        }

        if let updatedProject = result {
            self.project = updatedProject
            self.autoDevelopEnabled = newValue
            // Refresh the status after toggling
            await fetchAutoDevelopStatus()
        }
    }

    /// Update auto-develop with a new vision context (used for escalation response).
    func updateVisionContext(_ visionContext: String) async {
        isTogglingAutoDevelop = true
        defer { isTogglingAutoDevelop = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.updateProjectAutoDevelop(
                projectId: self.project.id,
                autoDevelop: true,
                visionContext: visionContext
            )
        }

        if let updatedProject = result {
            self.project = updatedProject
            await fetchAutoDevelopStatus()
        }
    }

    // MARK: - Style Guide (adj-201 / US4)

    /// Hex-color regex mirroring the backend's single source of truth
    /// (`projects-service.ts`: `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`) for client-side
    /// validation parity. A `static let` so we compile it once.
    private static let hexColorRegex = try! NSRegularExpression(
        pattern: "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
    )

    /// Validates a single hex color string against the backend's accepted forms
    /// (`#RGB` / `#RRGGBB`). Empty is NOT valid here — callers treat empty separately
    /// (empty primary = clear; empty secondary = omit).
    func isValidStyleGuideHex(_ value: String) -> Bool {
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return Self.hexColorRegex.firstMatch(in: value, range: range) != nil
    }

    /// Whether the current editor state is saveable.
    ///
    /// - An empty primary is the "clear the guide" gesture — always allowed.
    /// - A non-empty primary MUST be valid hex.
    /// - A non-empty secondary MUST be valid hex (empty secondary is fine).
    var canSaveStyleGuide: Bool {
        let primary = styleGuidePrimary.trimmingCharacters(in: .whitespacesAndNewlines)
        let secondary = styleGuideSecondary.trimmingCharacters(in: .whitespacesAndNewlines)

        if primary.isEmpty {
            return true // clearing the guide
        }
        if !isValidStyleGuideHex(primary) {
            return false
        }
        if !secondary.isEmpty && !isValidStyleGuideHex(secondary) {
            return false
        }
        return true
    }

    /// Load the project's style guide into the editor fields. An unset guide (both
    /// nil) leaves the fields empty. Resets the transient `styleGuideSaved` flag.
    func loadStyleGuide() async {
        styleGuideSaved = false
        let result = await performAsync(showLoading: false) {
            try await self.apiClient.getProjectStyleGuide(projectId: self.project.id)
        }
        if let guide = result {
            self.styleGuidePrimary = guide.brandColorPrimary ?? ""
            self.styleGuideSecondary = guide.brandColorSecondary ?? ""
            self.styleGuideError = nil
        } else if let message = self.errorMessage {
            // performAsync routed a failure through handleError → mirror onto the
            // dedicated style-guide error so the section can surface it inline.
            self.styleGuideError = message
        }
    }

    /// Persist the current editor state via `PUT /style-guide`.
    ///
    /// Validates locally first (parity with the backend) so malformed hex never hits
    /// the network. An empty primary clears the guide server-side; an empty secondary
    /// is sent as `nil` (serialized to JSON null) to clear just the secondary. On
    /// success the fields are refreshed from the server's authoritative response.
    func saveStyleGuide() async {
        styleGuideSaved = false
        styleGuideError = nil

        let primary = styleGuidePrimary.trimmingCharacters(in: .whitespacesAndNewlines)
        let secondaryTrimmed = styleGuideSecondary.trimmingCharacters(in: .whitespacesAndNewlines)

        // Client-side validation parity — block bad hex before any network call.
        guard canSaveStyleGuide else {
            if !primary.isEmpty && !isValidStyleGuideHex(primary) {
                styleGuideError = "Invalid primary brand color (use hex like #00ff00)."
            } else {
                styleGuideError = "Invalid secondary brand color (use hex like #00ff00)."
            }
            return
        }

        let secondary: String? = secondaryTrimmed.isEmpty ? nil : secondaryTrimmed

        isSavingStyleGuide = true
        defer { isSavingStyleGuide = false }

        let result = await performAsync(showLoading: false) {
            try await self.apiClient.updateProjectStyleGuide(
                projectId: self.project.id,
                primary: primary,
                secondary: secondary
            )
        }

        if let guide = result {
            self.styleGuidePrimary = guide.brandColorPrimary ?? ""
            self.styleGuideSecondary = guide.brandColorSecondary ?? ""
            self.styleGuideSaved = true
            self.styleGuideError = nil
        } else {
            // Save failed — surface the routed error on the dedicated field.
            self.styleGuideError = self.errorMessage ?? "Failed to save style guide."
        }
    }

    // MARK: - Computed Properties

    var activeSessionCount: Int {
        sessions.filter { $0.status != .offline }.count
    }

    var hasActiveSessions: Bool {
        activeSessionCount > 0
    }

    var abbreviatedPath: String {
        let path = project.path
        if let homeRange = path.range(of: "/Users/") {
            let afterUsers = path[homeRange.upperBound...]
            if let slashIndex = afterUsers.firstIndex(of: "/") {
                return "~" + String(afterUsers[slashIndex...])
            }
        }
        return path
    }
}
