import SwiftUI
import Combine
import AdjutantKit

/// ViewModel for swarm management — create, scale, and monitor swarms.
@MainActor
final class SwarmViewModel: ObservableObject {
    // MARK: - Published State

    @Published var swarms: [SwarmInfo] = []
    @Published var selectedSwarm: SwarmInfo?
    @Published var branches: [BranchStatus] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    // Create swarm form
    @Published var newProjectPath = ""
    @Published var newAgentCount = 3
    @Published var newBaseName = "agent"
    @Published var showingCreateSheet = false

    // MARK: - Dependencies

    private let apiClient: APIClient
    private var refreshTimer: Timer?

    // MARK: - Init

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? APIClient(
            baseURL: URL(string: "http://localhost:4201/api")!
        )
    }

    // MARK: - Lifecycle

    func onAppear() {
        Task { await refresh() }
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                await self.refreshSelectedSwarm()
            }
        }
    }

    func onDisappear() {
        refreshTimer?.invalidate()
        refreshTimer = nil
    }

    // MARK: - Actions

    func refresh() async {
        isLoading = true
        defer { isLoading = false }

        do {
            swarms = try await apiClient.getSwarms()
            if let selected = selectedSwarm {
                selectedSwarm = swarms.first { $0.id == selected.id }
                if selectedSwarm != nil {
                    await refreshBranches()
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshSelectedSwarm() async {
        guard let swarm = selectedSwarm else { return }
        do {
            selectedSwarm = try await apiClient.getSwarm(id: swarm.id)
        } catch {
            // Silently fail on background refresh
        }
    }

    func refreshBranches() async {
        guard let swarm = selectedSwarm else { return }
        do {
            branches = try await apiClient.getSwarmBranches(id: swarm.id)
        } catch {
            // Non-critical
        }
    }

    func createSwarm() async {
        guard !newProjectPath.isEmpty else {
            errorMessage = "Project path is required"
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let request = CreateSwarmRequest(
                projectPath: newProjectPath,
                agentCount: newAgentCount,
                coordinatorIndex: 0,
                baseName: newBaseName.isEmpty ? nil : newBaseName
            )
            let swarm = try await apiClient.createSwarm(request)
            swarms.append(swarm)
            selectedSwarm = swarm
            showingCreateSheet = false
            newProjectPath = ""
            newAgentCount = 3
            newBaseName = "agent"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addAgent(name: String? = nil) async {
        guard let swarm = selectedSwarm else { return }

        do {
            _ = try await apiClient.addAgentToSwarm(id: swarm.id, name: name)
            await refreshSelectedSwarm()
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func removeAgent(sessionId: String) async {
        guard let swarm = selectedSwarm else { return }

        do {
            _ = try await apiClient.removeAgentFromSwarm(
                id: swarm.id,
                sessionId: sessionId,
                removeWorktree: true
            )
            await refreshSelectedSwarm()
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func mergeBranch(_ branch: String) async {
        guard let swarm = selectedSwarm else { return }

        do {
            let result = try await apiClient.mergeSwarmBranch(id: swarm.id, branch: branch)
            if result.success {
                await refreshBranches()
            } else if let conflicts = result.conflicts, !conflicts.isEmpty {
                errorMessage = "Merge conflicts: \(conflicts.joined(separator: ", "))"
            } else {
                errorMessage = result.error ?? "Merge failed"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func destroySwarm(_ swarmId: String) async {
        do {
            _ = try await apiClient.destroySwarm(id: swarmId)
            swarms.removeAll { $0.id == swarmId }
            if selectedSwarm?.id == swarmId {
                selectedSwarm = nil
                branches = []
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectSwarm(_ swarm: SwarmInfo) {
        selectedSwarm = swarm
        Task { await refreshBranches() }
    }

    func clearError() {
        errorMessage = nil
    }
}
