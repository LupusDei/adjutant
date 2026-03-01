import Foundation
import SwiftUI
import Combine

/// Main application coordinator managing app-wide navigation.
@MainActor
final class AppCoordinator: Coordinator, ObservableObject {
    // MARK: - Published Properties

    /// Currently selected tab
    @Published var selectedTab: AppTab = .overview

    /// Sheet presentation state
    @Published var presentedSheet: SheetDestination?

    /// Alert presentation state
    @Published var presentedAlert: AlertDestination?

    // MARK: - Per-Tab Navigation Paths

    @Published var overviewPath = NavigationPath()
    @Published var chatPath = NavigationPath()
    @Published var agentsPath = NavigationPath()
    @Published var projectsPath = NavigationPath()
    @Published var beadsPath = NavigationPath()
    @Published var timelinePath = NavigationPath()
    @Published var proposalsPath = NavigationPath()
    @Published var settingsPath = NavigationPath()

    var path: NavigationPath {
        get { getPath(for: selectedTab) }
        set { setPath(newValue, for: selectedTab) }
    }

    private func getPath(for tab: AppTab) -> NavigationPath {
        switch tab {
        case .overview: return overviewPath
        case .chat: return chatPath
        case .crew: return agentsPath
        case .projects: return projectsPath
        case .beads: return beadsPath
        case .timeline: return timelinePath
        case .proposals: return proposalsPath
        case .settings: return settingsPath
        }
    }

    private func setPath(_ newPath: NavigationPath, for tab: AppTab) {
        switch tab {
        case .overview: overviewPath = newPath
        case .chat: chatPath = newPath
        case .crew: agentsPath = newPath
        case .projects: projectsPath = newPath
        case .beads: beadsPath = newPath
        case .timeline: timelinePath = newPath
        case .proposals: proposalsPath = newPath
        case .settings: settingsPath = newPath
        }
    }

    func pathBinding(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(
            get: { [weak self] in self?.getPath(for: tab) ?? NavigationPath() },
            set: { [weak self] in self?.setPath($0, for: tab) }
        )
    }

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init() {
        setupNotificationObservers()

        if let agentId = NotificationService.shared.pendingDeepLinkAgentId {
            NotificationService.shared.pendingDeepLinkAgentId = nil
            pendingChatAgentId = agentId
            selectedTab = .chat
        }
    }

    // MARK: - Notification Deep Linking

    private func setupNotificationObservers() {
        // Handle mail notification taps → redirect to chat
        NotificationCenter.default.publisher(for: .navigateToMail)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.selectTab(.chat)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .navigateToTask)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let taskId = notification.userInfo?["taskId"] as? String else { return }
                self?.handleTaskNotificationTap(taskId: taskId)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .navigateToChat)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let agentId = notification.userInfo?["agentId"] as? String else { return }
                self?.handleChatNotificationTap(agentId: agentId)
            }
            .store(in: &cancellables)
    }

    private func handleTaskNotificationTap(taskId: String) {
        selectTab(.beads)
        navigateReplacingPath(to: .beadDetail(id: taskId))
    }

    @Published var activeViewingAgentId: String?
    @Published var pendingChatAgentId: String?

    private func handleChatNotificationTap(agentId: String) {
        pendingChatAgentId = agentId
        selectTab(.chat)
    }

    // MARK: - Navigation

    func navigate(to route: AppRoute) {
        switch route {
        case .overview:
            selectTab(.overview)
        case .chat:
            selectTab(.chat)
        case .epics:
            selectTab(.beads)
        case .crew:
            selectTab(.crew)
        case .projects:
            selectTab(.projects)
        case .beads:
            selectTab(.beads)
        case .proposals:
            selectTab(.proposals)
        case .timeline:
            selectTab(.timeline)
        case .settings:
            selectTab(.settings)

        case .agentDetail, .beadDetail, .epicDetail, .proposalDetail, .projectDetail:
            appendToCurrentPath(route)

        case .themeSettings, .voiceSettings:
            appendToCurrentPath(route)
        }
    }

    func navigateReplacingPath(to route: AppRoute) {
        dismissKeyboard()
        var newPath = NavigationPath()
        newPath.append(route)
        setPath(newPath, for: selectedTab)
    }

    private func appendToCurrentPath(_ route: AppRoute) {
        dismissKeyboard()
        switch selectedTab {
        case .overview: overviewPath.append(route)
        case .chat: chatPath.append(route)
        case .crew: agentsPath.append(route)
        case .projects: projectsPath.append(route)
        case .beads: beadsPath.append(route)
        case .timeline: timelinePath.append(route)
        case .proposals: proposalsPath.append(route)
        case .settings: settingsPath.append(route)
        }
    }

    func selectTab(_ tab: AppTab) {
        dismissKeyboard()
        selectedTab = tab
    }

    func pop() {
        dismissKeyboard()
        if !path.isEmpty {
            path.removeLast()
        }
    }

    func popToRoot() {
        dismissKeyboard()
        setPath(NavigationPath(), for: selectedTab)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    // MARK: - Sheet Presentation

    func presentSheet(_ destination: SheetDestination) {
        presentedSheet = destination
    }

    func dismissSheet() {
        presentedSheet = nil
    }

    // MARK: - Alert Presentation

    func presentAlert(_ destination: AlertDestination) {
        presentedAlert = destination
    }

    func dismissAlert() {
        presentedAlert = nil
    }

    // MARK: - Deep Linking

    @discardableResult
    func handleDeepLink(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true),
              components.scheme == "adjutant" else {
            return false
        }

        switch components.host {
        case "chat":
            if let agentId = components.queryItems?.first(where: { $0.name == "agent" })?.value {
                pendingChatAgentId = agentId
            }
            selectTab(.chat)
            return true

        case "beads":
            if let id = components.queryItems?.first(where: { $0.name == "id" })?.value {
                selectTab(.beads)
                navigateReplacingPath(to: .beadDetail(id: id))
            } else {
                selectTab(.beads)
            }
            return true

        case "settings":
            selectTab(.settings)
            return true

        // Legacy deep links redirect to overview
        case "mail", "dashboard":
            selectTab(.overview)
            return true

        default:
            return false
        }
    }
}

// MARK: - Sheet Destinations

enum SheetDestination: Identifiable {
    case qrCode(url: String)

    var id: String {
        switch self {
        case .qrCode(let url):
            return "qrCode-\(url)"
        }
    }
}

// MARK: - Alert Destinations

enum AlertDestination: Identifiable {
    case error(title: String, message: String)
    case confirmation(title: String, message: String, onConfirm: () -> Void)

    var id: String {
        switch self {
        case .error(let title, _):
            return "error-\(title)"
        case .confirmation(let title, _, _):
            return "confirmation-\(title)"
        }
    }
}
