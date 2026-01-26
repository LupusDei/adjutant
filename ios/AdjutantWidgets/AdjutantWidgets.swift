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
/// for displaying Gas Town status information.
@main
struct AdjutantWidgetsBundle: WidgetBundle {
    var body: some Widget {
        // Live Activity for Gas Town status on Lock Screen and Dynamic Island
        AdjutantLiveActivity()

        // Home screen widget showing Gas Town status (small, medium, large)
        GastownWidget()
    }
}
