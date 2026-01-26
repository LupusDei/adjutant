import Foundation
import SwiftUI
import Combine

/// Main application coordinator managing app-wide navigation.
/// Handles tab selection and navigation within each tab's stack.
@MainActor
final class AppCoordinator: Coordinator, ObservableObject {
    // MARK: - Published Properties

    /// Current navigation path for the active tab
    @Published var path = NavigationPath()

    /// Currently selected tab
    @Published var selectedTab: AppTab = .dashboard

    /// Sheet presentation state
    @Published var presentedSheet: SheetDestination?

    /// Alert presentation state
    @Published var presentedAlert: AlertDestination?

    // MARK: - Private Properties

    /// Navigation paths for each tab (preserved during tab switches)
    private var tabPaths: [AppTab: NavigationPath] = [:]

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
        case .convoys:
            selectTab(.convoys)
        case .crew:
            selectTab(.crew)
        case .beads:
            selectTab(.beads)
        case .settings:
            selectTab(.settings)

        // Detail routes - push onto current tab's stack
        case .mailDetail, .convoyDetail, .agentDetail, .beadDetail, .polecatTerminal:
            path.append(route)

        // Modal routes - present as sheet
        case .mailCompose:
            presentedSheet = .mailCompose(replyTo: nil)

        // Settings sub-routes
        case .themeSettings, .voiceSettings, .tunnelSettings:
            path.append(route)
        }
    }

    /// Selects a tab and restores its navigation path
    func selectTab(_ tab: AppTab) {
        // Save current tab's path
        tabPaths[selectedTab] = path

        // Switch to new tab
        selectedTab = tab

        // Restore new tab's path
        path = tabPaths[tab] ?? NavigationPath()
    }

    /// Pops to the root of the current tab's navigation stack
    func popToRoot() {
        path = NavigationPath()
        tabPaths[selectedTab] = path
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
