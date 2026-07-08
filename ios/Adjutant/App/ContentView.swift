//
//  ContentView.swift
//  Adjutant
//
//  Created by Adjutant on 2026-01-25.
//

import SwiftUI

public struct ContentView: View {
    @StateObject private var dependencyContainer = DependencyContainer()
    @ObservedObject private var appState = AppState.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var showOnboarding: Bool
    /// The single app-root Bridge host (adj-207.1.2). Owns the one persistent
    /// avatar session/surface and is mounted ABOVE the tab bar so the Bridge
    /// survives navigation. Built with the launch-time (persisted) API base URL.
    @State private var bridgeHost = BridgeHost(apiBaseURL: AppState.shared.apiBaseURL)

    public init() {
        // Initialize showOnboarding based on current state
        _showOnboarding = State(initialValue: !AppState.shared.isOnboardingComplete)
    }

    /// Converts ThemeIdentifier to the corresponding CRT theme primary color
    private var themeColor: Color {
        appState.currentTheme.colorTheme.primary
    }

    public var body: some View {
        Group {
            if showOnboarding {
                OnboardingView {
                    withAnimation(.easeInOut(duration: 0.5)) {
                        showOnboarding = false
                    }
                }
            } else {
                // Mount the Bridge host ABOVE the tab bar so the avatar surface
                // survives navigation between screens (adj-207.1.2).
                BridgeHostContainer(host: bridgeHost) {
                    MainTabView(bridgeHost: bridgeHost)
                        .environmentObject(dependencyContainer)
                }
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            // Foundational persistence hook: keep the single session alive across
            // app background/foreground (background AUDIO config is US2 —
            // adj-207.3). Only transitions a live session; inert otherwise.
            switch newPhase {
            case .background:
                bridgeHost.session.enterBackground()
            case .active:
                bridgeHost.session.enterForeground()
            default:
                break
            }
        }

        .crtTheme(appState.currentTheme.colorTheme) // Inject theme into environment for all descendants
        .tint(themeColor) // Apply theme color to navigation back buttons and other tinted elements
        .preferredColorScheme(appState.currentTheme.colorTheme.preferredColorScheme)
        .task {
            // Phase B: Complete deferred AppState initialization (theme, observers, dependencies)
            AppState.shared.completeInitialization()
            // DataSyncService.shared.start() handled by AdjutantApp scene phase (.active) — adj-6yp4.1
            await AppState.shared.checkVoiceAvailability()
        }
    }
}

#Preview("Main App") {
    ContentView()
}

#Preview("Onboarding") {
    OnboardingView {
        print("Complete!")
    }
    .preferredColorScheme(.dark)
}
