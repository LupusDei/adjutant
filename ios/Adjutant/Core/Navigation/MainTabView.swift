import SwiftUI
import AdjutantKit

/// Main tab bar view providing navigation between all main sections.
/// Features custom CRT-styled tab bar with glow effects and badge support.
struct MainTabView: View {
    @StateObject private var coordinator = AppCoordinator()
    @EnvironmentObject private var dependencyContainer: DependencyContainer
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    var body: some View {
        VStack(spacing: 0) {
            // Offline indicator (shows when network unavailable)
            OfflineIndicator()

            // Main content area with navigation
            TabContent(
                selectedTab: coordinator.selectedTab,
                coordinator: coordinator
            )
            .environmentObject(coordinator)

            // Custom tab bar
            CRTTabBar(
                selectedTab: $coordinator.selectedTab,
                unreadCount: appState.unreadMailCount
            )
        }
        .background(theme.background.screen)
        .environmentObject(coordinator)
        .onChange(of: coordinator.selectedTab) { _, _ in
            // Dismiss keyboard on any tab navigation
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder),
                to: nil, from: nil, for: nil
            )
        }
        .task {
            // Deferred setup: start Combine notification observers for deep linking
            coordinator.start()
            // Start network monitoring
            NetworkMonitor.shared.configure()
        }
    }
}

// MARK: - Tab Content

/// Container for the content of each tab with navigation support.
/// Uses lazy rendering: only the selected tab's view body is evaluated.
/// Previously-visited tabs are kept alive to preserve navigation state,
/// but hidden tabs use EmptyView to avoid re-rendering on data updates.
private struct TabContent: View {
    let selectedTab: AppTab
    @ObservedObject var coordinator: AppCoordinator
    @ObservedObject private var appState = AppState.shared

    /// Tracks which tabs have been visited so their NavigationStack is preserved.
    @State private var visitedTabs: Set<AppTab> = [.overview]

    var body: some View {
        ZStack {
            ForEach(AppTab.allCases) { tab in
                NavigationStack(path: coordinator.pathBinding(for: tab)) {
                    // Only render the tab's real content if it's selected or was previously visited.
                    // Unvisited tabs get EmptyView — zero rendering cost.
                    // Hidden (visited but not selected) tabs keep their NavigationStack alive
                    // but their view body is not re-evaluated on @Published changes because
                    // the tab content is wrapped in a Group that SwiftUI can skip.
                    if selectedTab == tab {
                        tabView(for: tab)
                            .navigationDestination(for: AppRoute.self) { route in
                                destinationView(for: route)
                            }
                    } else if visitedTabs.contains(tab) {
                        // Keep NavigationStack alive but use a lightweight placeholder
                        // that doesn't subscribe to any @Published data
                        Color.clear
                            .navigationDestination(for: AppRoute.self) { route in
                                destinationView(for: route)
                            }
                    }
                }
                .opacity(selectedTab == tab ? 1 : 0)
                .allowsHitTesting(selectedTab == tab)
            }
        }
        .animation(nil, value: selectedTab)
        .onChange(of: selectedTab) { _, newTab in
            visitedTabs.insert(newTab)
        }
    }

    @ViewBuilder
    private func tabView(for tab: AppTab) -> some View {
        switch tab {
        case .overview:
            SwarmOverviewView()
        case .chat:
            ChatView(apiClient: AppState.shared.apiClient)
        case .crew:
            AgentListView(apiClient: AppState.shared.apiClient) { member in
                coordinator.navigateReplacingPath(to: .agentDetail(member: member))
            }
        case .projects:
            ProjectsListView(
                apiClient: AppState.shared.apiClient,
                onSelectProject: { project in
                    coordinator.navigateReplacingPath(to: .projectDetail(project: project))
                }
            )
        case .beads:
            BeadsView()
        case .timeline:
            TimelineView()
        case .proposals:
            ProposalsView()
        case .settings:
            SettingsView()
        }
    }

    @ViewBuilder
    private func destinationView(for route: AppRoute) -> some View {
        switch route {
        case .epicDetail(let id):
            EpicDetailView(epicId: id)
        case .agentDetail(let member):
            AgentDetailView(member: member)
        case .beadDetail(let id):
            BeadDetailView(beadId: id)
        case .proposalDetail(let id):
            ProposalDetailView(proposalId: id)
        case .projectDetail(let project):
            SwarmProjectDetailView(project: project)
        case .projectFiles(let projectId, let projectName):
            FileBrowserView(projectId: projectId, projectName: projectName)
        case .projectFile(let projectId, _, let filePath):
            FileContentView(projectId: projectId, filePath: filePath)
        case .themeSettings, .voiceSettings:
            SettingsView()
        default:
            EmptyView()
        }
    }
}

// MARK: - CRT Tab Bar

/// Custom tab bar with CRT phosphor styling and glow effects.
struct CRTTabBar: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared
    @Binding var selectedTab: AppTab
    let unreadCount: Int
    var visibleTabs: [AppTab] = AppTab.allCases

    var body: some View {
        HStack(spacing: 0) {
            ForEach(visibleTabs) { tab in
                CRTTabBarItem(
                    tab: tab,
                    isSelected: selectedTab == tab,
                    badgeCount: tab == .chat ? unreadCount : 0
                ) {
                    selectedTab = tab
                }
            }
        }
        .padding(.top, CRTTheme.Spacing.xs)
        .padding(.bottom, CRTTheme.Spacing.sm)
        .background(tabBarBackground)
        .gesture(
            DragGesture(minimumDistance: 20, coordinateSpace: .local)
                .onEnded { value in
                    // Swipe down on tab bar dismisses keyboard
                    if value.translation.height > 20 {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder),
                            to: nil, from: nil, for: nil
                        )
                    }
                }
        )
    }

    private var tabBarBackground: some View {
        theme.background.panel
            .overlay(
                Rectangle()
                    .frame(height: 1)
                    .foregroundColor(theme.primary.opacity(0.3)),
                alignment: .top
            )
            .shadow(color: theme.primary.opacity(0.1), radius: 8, y: -4)
    }
}

// MARK: - Tab Bar Item

/// Individual tab bar item with icon, label, and optional badge.
private struct CRTTabBarItem: View {
    @Environment(\.crtTheme) private var theme

    let tab: AppTab
    let isSelected: Bool
    let badgeCount: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: CRTTheme.Spacing.xxs) {
                // Icon with badge overlay
                ZStack(alignment: .topTrailing) {
                    Image(systemName: tab.systemImage)
                        .font(.system(size: 20, weight: isSelected ? .semibold : .regular))
                        .foregroundColor(isSelected ? theme.primary : theme.dim)
                        .crtGlow(
                            color: theme.primary,
                            radius: isSelected ? 6 : 0,
                            intensity: isSelected ? 0.5 : 0
                        )

                    // Badge for unread count
                    if badgeCount > 0 {
                        UnreadBadge(badgeCount)
                            .offset(x: 8, y: -4)
                    }
                }
                .frame(height: 24)

                // Label
                Text(tab.title)
                    .font(CRTTheme.Typography.font(size: 9, weight: isSelected ? .bold : .medium))
                    .tracking(CRTTheme.Typography.letterSpacing)
                    .foregroundColor(isSelected ? theme.primary : theme.dim)
                    .crtGlow(
                        color: theme.primary,
                        radius: isSelected ? 3 : 0,
                        intensity: isSelected ? 0.4 : 0
                    )
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityHint("Tab \(tab.rawValue + 1) of \(AppTab.allCases.count)")
    }
}

// MARK: - Type Aliases

/// Beads tab view - uses BeadsListView from Features/Beads.
typealias BeadsView = BeadsListView

// MARK: - Preview

#Preview("Main Tab View") {
    MainTabView()
        .environmentObject(DependencyContainer())
}

#Preview("Tab Bar Only") {
    VStack {
        Spacer()
        CRTTabBar(selectedTab: .constant(.overview), unreadCount: 5)
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
