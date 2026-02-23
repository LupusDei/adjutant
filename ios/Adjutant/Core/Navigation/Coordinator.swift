import Foundation
import SwiftUI
import AdjutantKit

/// Protocol defining the interface for navigation coordinators.
/// Coordinators manage navigation flow and decouple navigation logic from views.
@MainActor
protocol Coordinator: AnyObject, ObservableObject {
    associatedtype Route: Hashable

    /// The navigation path for programmatic navigation
    var path: NavigationPath { get set }

    /// Navigate to a specific route
    func navigate(to route: Route)

    /// Pop to the root of the navigation stack
    func popToRoot()

    /// Pop one level in the navigation stack
    func pop()
}

/// Default implementations for Coordinator
extension Coordinator {
    func popToRoot() {
        path = NavigationPath()
    }

    func pop() {
        if !path.isEmpty {
            path.removeLast()
        }
    }
}

// MARK: - App Routes

/// Defines all navigable routes in the application
enum AppRoute: Hashable {
    // Tab routes
    case dashboard
    case mail
    case chat
    case epics
    case crew
    case projects
    case beads
    case settings

    // Detail routes
    case mailDetail(id: String)
    case mailCompose(replyTo: String? = nil)
    case epicDetail(id: String)
    case agentDetail(member: CrewMember)
    case beadDetail(id: String)
    case polecatTerminal(rig: String, polecat: String)

    // Project routes
    case projectDetail(rig: RigStatus)
    case swarmProjectDetail(project: Project)

    // Settings sub-routes
    case themeSettings
    case voiceSettings
    case tunnelSettings
}

// MARK: - Tab Definition

/// Defines the main tabs in the application
enum AppTab: Int, CaseIterable, Identifiable {
    case dashboard
    case mail
    case chat
    case epics
    case crew
    case projects
    case beads
    case settings

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .dashboard: return "OVERVIEW"
        case .mail: return "MAIL"
        case .chat: return "CHAT"
        case .epics: return "EPICS"
        case .crew: return "AGENTS"
        case .projects: return "PROJECTS"
        case .beads: return "BEADS"
        case .settings: return "SETTINGS"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "square.grid.2x2"
        case .mail: return "envelope"
        case .chat: return "message"
        case .epics: return "list.bullet.clipboard"
        case .crew: return "person.3"
        case .projects: return "folder"
        case .beads: return "circle.grid.3x3"
        case .settings: return "gearshape"
        }
    }
}
