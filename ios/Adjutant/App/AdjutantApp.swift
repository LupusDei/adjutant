//
//  AdjutantApp.swift
//  Adjutant
//
//  Created by Adjutant on 2026-01-25.
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
            BeadStatusMonitor.shared.handleScenePhaseChange(to: newPhase)

            // Manage SSE connection based on app lifecycle
            switch newPhase {
            case .active:
                DataSyncService.shared.startEventStream()
            case .background:
                DataSyncService.shared.stopEventStream()
            case .inactive:
                break
            @unknown default:
                break
            }
        }
    }
}
