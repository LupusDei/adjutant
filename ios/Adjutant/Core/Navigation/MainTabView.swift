import SwiftUI
import AdjutantKit

/// Main tab bar view providing navigation between all 7 main sections.
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
            TabContent(selectedTab: coordinator.selectedTab, coordinator: coordinator)
                .environmentObject(coordinator)

            // Custom tab bar
            CRTTabBar(
                selectedTab: $coordinator.selectedTab,
                unreadCount: appState.unreadMailCount
            )
        }
        .background(CRTTheme.Background.screen)
        .environmentObject(coordinator)
        .onAppear {
            // Start network monitoring
            _ = NetworkMonitor.shared
        }
    }
}

// MARK: - Tab Content

/// Container for the content of each tab with navigation support.
private struct TabContent: View {
    let selectedTab: AppTab
    @ObservedObject var coordinator: AppCoordinator
    @Environment(\.scenePhase) private var scenePhase

    /// Used to force TabView to reset its internal paging state when app returns from background.
    /// Without this, the page-style TabView can get stuck in an intermediate position between tabs.
    @State private var tabViewId = UUID()

    var body: some View {
        TabView(selection: Binding(
            get: { selectedTab },
            set: { coordinator.selectTab($0) }
        )) {
            ForEach(AppTab.allCases) { tab in
                NavigationStack(path: $coordinator.path) {
                    tabView(for: tab)
                        .navigationDestination(for: AppRoute.self) { route in
                            destinationView(for: route)
                        }
                }
                .tag(tab)
            }
        }
        #if os(iOS)
        .tabViewStyle(.page(indexDisplayMode: .never))
        #endif
        .id(tabViewId)
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                // Reset TabView ID to force a clean layout and snap to current tab.
                // This fixes the stuck UI state that can occur when the app is
                // backgrounded during a page swipe gesture.
                tabViewId = UUID()
            }
        }
    }

    @ViewBuilder
    private func tabView(for tab: AppTab) -> some View {
        switch tab {
        case .dashboard:
            DashboardView()
        case .mail:
            MailListView()
        case .chat:
            ChatView(apiClient: AppState.shared.apiClient)
        case .convoys:
            ConvoysListView()
        case .crew:
            CrewListView(apiClient: AppState.shared.apiClient) { member in
                coordinator.navigate(to: .agentDetail(member: member))
            }
        case .beads:
            BeadsView()
        case .settings:
            SettingsView()
        }
    }

    @ViewBuilder
    private func destinationView(for route: AppRoute) -> some View {
        switch route {
        case .mailDetail(let id):
            MailDetailView(messageId: id)
        case .convoyDetail(let id):
            ConvoyDetailPlaceholder(id: id)
        case .agentDetail(let member):
            CrewDetailView(member: member)
        case .beadDetail(let id):
            BeadDetailView(beadId: id)
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
    @Binding var selectedTab: AppTab
    let unreadCount: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                CRTTabBarItem(
                    tab: tab,
                    isSelected: selectedTab == tab,
                    badgeCount: tab == .mail ? unreadCount : 0
                ) {
                    withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                        selectedTab = tab
                    }
                }
            }
        }
        .padding(.top, CRTTheme.Spacing.xs)
        .padding(.bottom, CRTTheme.Spacing.sm)
        .background(tabBarBackground)
    }

    private var tabBarBackground: some View {
        CRTTheme.Background.panel
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

// MARK: - Detail Placeholders

private struct ConvoyDetailPlaceholder: View {
    let id: String
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack {
            CRTText("CONVOY DETAIL", style: .header)
            CRTText("ID: \(id)", style: .mono, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(CRTTheme.Background.screen)
    }
}


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
    .background(CRTTheme.Background.screen)
}

#Preview("Tab Bar - Mail Selected") {
    VStack {
        Spacer()
        CRTTabBar(selectedTab: .constant(.mail), unreadCount: 12)
    }
    .background(CRTTheme.Background.screen)
}
