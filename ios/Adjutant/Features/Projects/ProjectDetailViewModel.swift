import Foundation
import Combine
import AdjutantKit

/// ViewModel for the Project Detail view, showing agents for a specific rig.
@MainActor
final class ProjectDetailViewModel: BaseViewModel {
    // MARK: - Published Properties

    /// The rig status (refreshed from API)
    @Published private(set) var rig: RigStatus

    /// Crew members for this rig
    @Published private(set) var crewMembers: [CrewMember] = []

    /// Whether a polecat spawn is in progress
    @Published private(set) var isSpawning = false

    /// Spawn result message
    @Published var spawnMessage: String?

    // MARK: - Properties

    let rigName: String
    private let apiClient: APIClient

    // MARK: - Initialization

    init(rig: RigStatus, apiClient: APIClient? = nil) {
        self.rig = rig
        self.rigName = rig.name
        self.apiClient = apiClient ?? AppState.shared.apiClient
        super.init()
    }

    // MARK: - Data Loading

    override func refresh() async {
        await performAsync(showLoading: false) {
            // Refresh full status and extract this rig
            let status = try await self.apiClient.getStatus()
            if let updated = status.rigs.first(where: { $0.name == self.rigName }) {
                self.rig = updated
            }

            // Get crew members filtered to this rig
            let allCrew = try await self.apiClient.getAgents()
            self.crewMembers = allCrew.filter { $0.rig == self.rigName }
        }
    }

    // MARK: - Actions

    /// Spawn a new polecat for this rig
    func spawnPolecat() async {
        isSpawning = true
        spawnMessage = nil

        do {
            let response = try await apiClient.spawnPolecat(rig: rigName)
            spawnMessage = "Polecat spawn requested for \(response.rig)"
            await refresh()
        } catch {
            spawnMessage = "Spawn failed: \(error.localizedDescription)"
        }

        isSpawning = false
    }

    // MARK: - Computed Properties

    /// All agents as a flat list with type info
    var allAgents: [AgentEntry] {
        var agents: [AgentEntry] = []

        agents.append(AgentEntry(name: rig.witness.name, type: .witness, status: rig.witness))
        agents.append(AgentEntry(name: rig.refinery.name, type: .refinery, status: rig.refinery))

        for crew in rig.crew {
            agents.append(AgentEntry(name: crew.name, type: .crew, status: crew))
        }

        for polecat in rig.polecats {
            agents.append(AgentEntry(name: polecat.name, type: .polecat, status: polecat))
        }

        return agents
    }

    /// Running agent count
    var runningCount: Int {
        allAgents.filter { $0.status.running }.count
    }

    /// Total agent count
    var totalCount: Int {
        allAgents.count
    }
}

// MARK: - Supporting Types

/// A single agent entry for display in the project detail
struct AgentEntry: Identifiable {
    let name: String
    let type: AgentType
    let status: AgentStatus

    var id: String { "\(type.rawValue)/\(name)" }
}
