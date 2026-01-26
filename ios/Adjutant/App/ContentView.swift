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
        .preferredColorScheme(.dark)
        .task {
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
