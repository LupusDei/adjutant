import Foundation
import SwiftUI
import AdjutantKit

/// Protocol defining the interface for navigation coordinators.
@MainActor
protocol Coordinator: AnyObject, ObservableObject {
    associatedtype Route: Hashable

    var path: NavigationPath { get set }
    func navigate(to route: Route)
    func popToRoot()
    func pop()
}

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
    case overview
    case chat
    case epics
    case crew
    case projects
    case beads
    case proposals
    case timeline
    case settings

    // Detail routes
    case agentDetail(member: CrewMember)
    case beadDetail(id: String)
    case epicDetail(id: String)
    case proposalDetail(id: String)

    // Project routes
    case projectDetail(project: Project)

    // Settings sub-routes
    case themeSettings
    case voiceSettings
}

// MARK: - Tab Definition

/// Defines the main tabs in the application.
/// Case order determines tab bar display order (via CaseIterable).
enum AppTab: Int, CaseIterable, Identifiable {
    case overview
    case chat
    case beads
    case timeline
    case crew
    case projects
    case proposals
    case settings

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .overview: return "OVERVIEW"
        case .chat: return "CHAT"
        case .crew: return "AGENTS"
        case .projects: return "PROJECTS"
        case .beads: return "BEADS"
        case .timeline: return "TIMELINE"
        case .proposals: return "PROPOSE"
        case .settings: return "SETTINGS"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "rectangle.3.group"
        case .chat: return "message"
        case .crew: return "person.3"
        case .projects: return "folder"
        case .beads: return "circle.grid.3x3"
        case .timeline: return "clock.arrow.circlepath"
        case .proposals: return "lightbulb"
        case .settings: return "gearshape"
        }
    }
}
