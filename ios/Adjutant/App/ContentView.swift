//
//  ContentView.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-25.
//

import SwiftUI

public struct ContentView: View {
    @StateObject private var dependencyContainer = DependencyContainer()

    public init() {}

    public var body: some View {
        MainTabView()
            .environmentObject(dependencyContainer)
            .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
}
