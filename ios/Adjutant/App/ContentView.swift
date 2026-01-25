//
//  ContentView.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-25.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var dependencyContainer = DependencyContainer()

    var body: some View {
        MainTabView()
            .environmentObject(dependencyContainer)
            .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
