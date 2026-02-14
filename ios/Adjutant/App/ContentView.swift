//
//  ContentView.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-25.
//

import SwiftUI

public struct ContentView: View {
    @StateObject private var dependencyContainer = DependencyContainer()
    @ObservedObject private var appState = AppState.shared
    @State private var showOnboarding: Bool

    public init() {
        // Initialize showOnboarding based on current state
        _showOnboarding = State(initialValue: !AppState.shared.isOnboardingComplete)
    }

    /// Converts ThemeIdentifier to the corresponding CRT theme primary color
    private var themeColor: Color {
        switch appState.currentTheme {
        case .green: return CRTTheme.ColorTheme.green.primary
        case .red: return CRTTheme.ColorTheme.red.primary
        case .blue: return CRTTheme.ColorTheme.blue.primary
        case .tan: return CRTTheme.ColorTheme.tan.primary
        case .pink: return CRTTheme.ColorTheme.pink.primary
        case .purple: return CRTTheme.ColorTheme.purple.primary
        }
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
                MainTabView()
                    .environmentObject(dependencyContainer)
            }
        }
        .tint(themeColor) // Apply theme color to navigation back buttons and other tinted elements
        .preferredColorScheme(.dark)
        .task {
            async let voiceCheck: () = AppState.shared.checkVoiceAvailability()
            async let modeSync: () = AppState.shared.fetchDeploymentMode()
            _ = await (voiceCheck, modeSync)
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
