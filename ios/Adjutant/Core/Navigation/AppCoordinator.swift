import Foundation
import SwiftUI
import Combine

/// Main application coordinator managing app-wide navigation.
/// Handles tab selection and navigation within each tab's stack.
@MainActor
final class AppCoordinator: Coordinator, ObservableObject {
    // MARK: - Published Properties

    /// Navigation paths for each tab (each tab has independent navigation)
    @Published var tabPaths: [AppTab: NavigationPath] = [:]

    /// Currently selected tab
    @Published var selectedTab: AppTab = .dashboard

    /// Navigation path for the current tab (required by Coordinator protocol)
    var path: NavigationPath {
        get { tabPaths[selectedTab] ?? NavigationPath() }
        set { tabPaths[selectedTab] = newValue }
    }

    /// Sheet presentation state
    @Published var presentedSheet: SheetDestination?

    /// Alert presentation state
    @Published var presentedAlert: AlertDestination?

    /// Cancellables for notification observers
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init() {
        // Initialize paths for all tabs
        for tab in AppTab.allCases {
            tabPaths[tab] = NavigationPath()
        }

        // Set up notification deep linking observers
        setupNotificationObservers()
    }

    // MARK: - Tab Navigation Paths

    /// Returns a binding to the navigation path for a specific tab.
    /// Each tab has its own independent navigation stack.
    func pathBinding(for tab: AppTab) -> Binding<NavigationPath> {
        Binding(
            get: { self.tabPaths[tab] ?? NavigationPath() },
            set: { newPath in
                self.tabPaths[tab] = newPath
            }
        )
    }

    // MARK: - Notification Deep Linking

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
        case .beads:
            selectTab(.beads)
        case .settings:
            selectTab(.settings)

        // Detail routes - push onto current tab's stack
        case .mailDetail, .epicDetail, .agentDetail, .beadDetail, .polecatTerminal:
            tabPaths[selectedTab, default: NavigationPath()].append(route)

        // Modal routes - present as sheet
        case .mailCompose:
            presentedSheet = .mailCompose(replyTo: nil)

        // Settings sub-routes
        case .themeSettings, .voiceSettings, .tunnelSettings:
            tabPaths[selectedTab, default: NavigationPath()].append(route)
        }
    }

    /// Selects a tab (each tab maintains its own navigation path independently)
    func selectTab(_ tab: AppTab) {
        selectedTab = tab
    }

    /// Pops to the root of the current tab's navigation stack
    func popToRoot() {
        tabPaths[selectedTab] = NavigationPath()
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
