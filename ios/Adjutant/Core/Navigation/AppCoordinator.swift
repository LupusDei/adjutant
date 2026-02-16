import Foundation
import SwiftUI
import Combine

/// Main application coordinator managing app-wide navigation.
/// Handles tab selection and navigation within each tab's stack.
@MainActor
final class AppCoordinator: Coordinator, ObservableObject {
    // MARK: - Published Properties

    /// Currently selected tab
    @Published var selectedTab: AppTab = .dashboard

    /// Sheet presentation state
    @Published var presentedSheet: SheetDestination?

    /// Alert presentation state
    @Published var presentedAlert: AlertDestination?

    // MARK: - Per-Tab Navigation Paths

    /// Navigation paths for each tab (each tab has its own independent path)
    @Published var dashboardPath = NavigationPath()
    @Published var mailPath = NavigationPath()
    @Published var chatPath = NavigationPath()
    @Published var epicsPath = NavigationPath()
    @Published var crewPath = NavigationPath()
    @Published var projectsPath = NavigationPath()
    @Published var beadsPath = NavigationPath()
    @Published var settingsPath = NavigationPath()

    /// Current tab's path (required by Coordinator protocol)
    /// This is a computed property that proxies to the selected tab's path
    var path: NavigationPath {
        get { getPath(for: selectedTab) }
        set { setPath(newValue, for: selectedTab) }
    }

    /// Returns the navigation path for a specific tab
    private func getPath(for tab: AppTab) -> NavigationPath {
        switch tab {
        case .dashboard: return dashboardPath
        case .mail: return mailPath
        case .chat: return chatPath
        case .epics: return epicsPath
        case .crew: return crewPath
        case .projects: return projectsPath
        case .beads: return beadsPath
        case .settings: return settingsPath
        }
    }

    /// Sets the path for a specific tab
    private func setPath(_ newPath: NavigationPath, for tab: AppTab) {
        switch tab {
        case .dashboard: dashboardPath = newPath
        case .mail: mailPath = newPath
        case .chat: chatPath = newPath
        case .epics: epicsPath = newPath
        case .crew: crewPath = newPath
        case .projects: projectsPath = newPath
        case .beads: beadsPath = newPath
        case .settings: settingsPath = newPath
        }
    }

    /// Returns binding to the navigation path for a specific tab
    func pathBinding(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(
            get: { [weak self] in self?.getPath(for: tab) ?? NavigationPath() },
            set: { [weak self] in self?.setPath($0, for: tab) }
        )
    }

    // MARK: - Private Properties

    /// Cancellables for notification observers
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init() {
        // Set initial tab based on deployment mode
        self.selectedTab = AppState.shared.deploymentMode.defaultTab

        // Set up notification deep linking observers
        setupNotificationObservers()
        setupModeObserver()
    }

    // MARK: - Notification Deep Linking

    /// Observes deployment mode changes and adjusts selected tab if needed
    private func setupModeObserver() {
        AppState.shared.$deploymentMode
            .receive(on: DispatchQueue.main)
            .sink { [weak self] mode in
                guard let self = self else { return }
                let visibleTabs = mode.visibleTabs
                if !visibleTabs.contains(self.selectedTab) {
                    self.selectedTab = mode.defaultTab
                }
            }
            .store(in: &cancellables)
    }

    /// Sets up observers for notification tap deep linking
    private func setupNotificationObservers() {
        // Handle mail notification taps
        NotificationCenter.default.publisher(for: .navigateToMail)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let mailId = notification.userInfo?["mailId"] as? String else { return }
                self?.handleMailNotificationTap(mailId: mailId)
            }
            .store(in: &cancellables)

        // Handle task notification taps
        NotificationCenter.default.publisher(for: .navigateToTask)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let taskId = notification.userInfo?["taskId"] as? String else { return }
                self?.handleTaskNotificationTap(taskId: taskId)
            }
            .store(in: &cancellables)
    }

    /// Handles navigation when a mail notification is tapped
    /// - Parameter mailId: The ID of the mail to navigate to
    private func handleMailNotificationTap(mailId: String) {
        selectTab(.mail)
        navigate(to: .mailDetail(id: mailId))
    }

    /// Handles navigation when a task notification is tapped
    /// - Parameter taskId: The ID of the task/bead to navigate to
    private func handleTaskNotificationTap(taskId: String) {
        selectTab(.beads)
        navigate(to: .beadDetail(id: taskId))
    }

    // MARK: - Navigation

    func navigate(to route: AppRoute) {
        switch route {
        // Tab routes - switch to the tab
        case .dashboard:
            selectTab(.dashboard)
        case .mail:
            selectTab(.mail)
        case .chat:
            selectTab(.chat)
        case .epics:
            selectTab(.epics)
        case .crew:
            selectTab(.crew)
        case .projects:
            selectTab(.projects)
        case .beads:
            selectTab(.beads)
        case .settings:
            selectTab(.settings)

        // Detail routes - push onto current tab's stack
        case .mailDetail, .epicDetail, .agentDetail, .beadDetail, .polecatTerminal, .projectDetail:
            appendToCurrentPath(route)

        // Modal routes - present as sheet
        case .mailCompose:
            presentedSheet = .mailCompose(replyTo: nil)

        // Settings sub-routes
        case .themeSettings, .voiceSettings, .tunnelSettings:
            appendToCurrentPath(route)
        }
    }

    /// Appends a route to the current tab's navigation path
    private func appendToCurrentPath(_ route: AppRoute) {
        switch selectedTab {
        case .dashboard: dashboardPath.append(route)
        case .mail: mailPath.append(route)
        case .chat: chatPath.append(route)
        case .epics: epicsPath.append(route)
        case .crew: crewPath.append(route)
        case .projects: projectsPath.append(route)
        case .beads: beadsPath.append(route)
        case .settings: settingsPath.append(route)
        }
    }

    /// Selects a tab (each tab maintains its own navigation path)
    func selectTab(_ tab: AppTab) {
        selectedTab = tab
    }

    /// Pops to the root of the current tab's navigation stack
    func popToRoot() {
        setPath(NavigationPath(), for: selectedTab)
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

    /// Handles a deep link URL
    /// - Parameter url: The URL to handle
    /// - Returns: True if the URL was handled
    @discardableResult
    func handleDeepLink(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true),
              components.scheme == "adjutant" else {
            return false
        }

        switch components.host {
        case "mail":
            if let id = components.queryItems?.first(where: { $0.name == "id" })?.value {
                selectTab(.mail)
                navigate(to: .mailDetail(id: id))
            } else {
                selectTab(.mail)
            }
            return true

        case "beads":
            if let id = components.queryItems?.first(where: { $0.name == "id" })?.value {
                selectTab(.beads)
                navigate(to: .beadDetail(id: id))
            } else {
                selectTab(.beads)
            }
            return true

        case "settings":
            selectTab(.settings)
            return true

        default:
            return false
        }
    }
}

// MARK: - Sheet Destinations

enum SheetDestination: Identifiable {
    case mailCompose(replyTo: String?)
    case qrCode(url: String)

    var id: String {
        switch self {
        case .mailCompose(let replyTo):
            return "mailCompose-\(replyTo ?? "new")"
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
