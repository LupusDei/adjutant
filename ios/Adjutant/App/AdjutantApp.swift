//
//  AdjutantApp.swift
//  Adjutant
//
//  Created by Gas Town on 2026-01-25.
//

import SwiftUI
import AdjutantUI

@main
struct AdjutantApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, newPhase in
            BackgroundTaskService.shared.handleScenePhaseChange(to: newPhase)
        }
    }
}
