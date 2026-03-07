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

            // Manage SSE connection based on app lifecycle.
            // start() is deferred to here (post first render) to avoid blocking launch.
            switch newPhase {
            case .active:
                DataSyncService.shared.start()
                // Defer SSE reconnection by one RunLoop cycle so the UI can
                // stabilize first. Without this, the SSE connect + data refresh
                // cascade saturates the main actor and freezes the UI for 2-5s.
                DispatchQueue.main.async {
                    DataSyncService.shared.startEventStream()
                }
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
