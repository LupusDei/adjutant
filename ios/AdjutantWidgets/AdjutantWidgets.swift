//
//  AdjutantWidgets.swift
//  AdjutantWidgets
//
//  Created by Gas Town on 2026-01-26.
//

import SwiftUI
import WidgetKit

/// Main entry point for the Adjutant widget extension bundle.
/// This bundle contains Live Activity widgets and home screen widgets
/// for displaying Adjutant status information.
@main
struct AdjutantWidgetsBundle: WidgetBundle {
    var body: some Widget {
        // Live Activity for Adjutant status on Lock Screen and Dynamic Island
        AdjutantLiveActivity()

        // Home screen widget showing Adjutant status (small, medium, large)
        AdjutantWidget()
    }
}
