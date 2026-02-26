import SwiftUI
import AdjutantKit

/// Main tab bar view providing navigation between all 7 main sections.
/// Features custom CRT-styled tab bar with glow effects and badge support.
struct MainTabView: View {
    @StateObject private var coordinator = AppCoordinator()
    @EnvironmentObject private var dependencyContainer: DependencyContainer
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    /// Tabs visible in the current deployment mode
    private var visibleTabs: [AppTab] {
        let visible = appState.deploymentMode.visibleTabs
        return AppTab.allCases.filter { visible.contains($0) }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Offline indicator (shows when network unavailable)
            OfflineIndicator()

            // Main content area with navigation
            TabContent(
                selectedTab: coordinator.selectedTab,
                coordinator: coordinator,
                visibleTabs: visibleTabs
            )
            .environmentObject(coordinator)

            // Custom tab bar
            CRTTabBar(
                selectedTab: $coordinator.selectedTab,
                unreadCount: appState.unreadMailCount,
                visibleTabs: visibleTabs
            )
        }
        .background(theme.background.screen)
        .environmentObject(coordinator)
        .onAppear {
            // Start network monitoring
            _ = NetworkMonitor.shared
        }
        .onChange(of: appState.deploymentMode) { _, newMode in
            // If current tab is hidden in new mode, switch to first visible tab
            if !newMode.visibleTabs.contains(coordinator.selectedTab) {
                if let firstVisible = AppTab.allCases.first(where: { newMode.visibleTabs.contains($0) }) {
                    coordinator.selectTab(firstVisible)
                }
            }
        }
    }
}

// MARK: - Tab Content

/// Container for the content of each tab with navigation support.
private struct TabContent: View {
    let selectedTab: AppTab
    @ObservedObject var coordinator: AppCoordinator
    @ObservedObject private var appState = AppState.shared
    let visibleTabs: [AppTab]
    var body: some View {
        ZStack {
            ForEach(visibleTabs) { tab in
                NavigationStack(path: coordinator.pathBinding(for: tab)) {
                    tabView(for: tab)
                        .navigationDestination(for: AppRoute.self) { route in
                            destinationView(for: route)
                        }
                }
                .opacity(selectedTab == tab ? 1 : 0)
                .allowsHitTesting(selectedTab == tab)
            }
        }
        .animation(nil, value: selectedTab)
    }

    @ViewBuilder
    private func tabView(for tab: AppTab) -> some View {
        switch tab {
        case .overview:
            SwarmOverviewView()
        case .dashboard:
            DashboardView()
        case .mail:
            MailListView()
        case .chat:
            ChatView(apiClient: AppState.shared.apiClient)
        case .epics:
            EpicsListView()
        case .crew:
            AgentListView(apiClient: AppState.shared.apiClient) { member in
                coordinator.navigateReplacingPath(to: .agentDetail(member: member))
            }
        case .projects:
            ProjectsListView(
                apiClient: AppState.shared.apiClient,
                onSelectRig: { rig in
                    coordinator.navigateReplacingPath(to: .projectDetail(rig: rig))
                },
                onSelectProject: { project in
                    coordinator.navigateReplacingPath(to: .swarmProjectDetail(project: project))
                }
            )
        case .beads:
            BeadsView()
        case .proposals:
            ProposalsView()
        case .settings:
            SettingsView()
        }
    }

    @ViewBuilder
    private func destinationView(for route: AppRoute) -> some View {
        switch route {
        case .mailDetail(let id):
            MailDetailView(messageId: id)
        case .epicDetail(let id):
            EpicDetailView(epicId: id)
        case .agentDetail(let member):
            AgentDetailView(member: member)
        case .beadDetail(let id):
            BeadDetailView(beadId: id)
        case .proposalDetail(let id):
            ProposalDetailView(proposalId: id)
        case .projectDetail(let rig):
            ProjectDetailView(rig: rig)
        case .swarmProjectDetail(let project):
            SwarmProjectDetailView(project: project)
        case .themeSettings, .voiceSettings, .tunnelSettings:
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
                    badgeCount: tab == .mail ? unreadCount : 0
                ) {
                    selectedTab = tab
                }
            }
        }
        .padding(.top, CRTTheme.Spacing.xs)
        .padding(.bottom, CRTTheme.Spacing.sm)
        .background(tabBarBackground)
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
        CRTTabBar(selectedTab: .constant(.dashboard), unreadCount: 5)
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("Tab Bar - Mail Selected") {
    VStack {
        Spacer()
        CRTTabBar(selectedTab: .constant(.mail), unreadCount: 12)
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
