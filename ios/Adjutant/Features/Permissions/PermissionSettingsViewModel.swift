import SwiftUI
import Combine
import AdjutantKit

/// ViewModel for permission settings management.
@MainActor
final class PermissionSettingsViewModel: ObservableObject {
    @Published var defaultMode: String = "manual"
    @Published var sessionOverrides: [String: String] = [:]
    @Published var toolOverrides: [String: String] = [:]
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient: APIClient

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? APIClient()
    }

    func onAppear() {
        Task { await loadConfig() }
    }

    func loadConfig() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let config = try await apiClient.getPermissionConfig()
            defaultMode = config.defaultMode
            sessionOverrides = config.sessions
            toolOverrides = config.toolOverrides
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveConfig() async {
        do {
            let update = PermissionConfigUpdate(
                defaultMode: defaultMode,
                sessions: sessionOverrides.isEmpty ? nil : sessionOverrides,
                toolOverrides: toolOverrides.isEmpty ? nil : toolOverrides
            )
            let config = try await apiClient.updatePermissionConfig(update)
            defaultMode = config.defaultMode
            sessionOverrides = config.sessions
            toolOverrides = config.toolOverrides
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setToolOverride(_ tool: String, mode: String) {
        toolOverrides[tool] = mode
    }

    func removeToolOverride(_ tool: String) {
        toolOverrides.removeValue(forKey: tool)
    }
}
