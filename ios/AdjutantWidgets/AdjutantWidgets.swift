//
//  AdjutantWidgets.swift
//  AdjutantWidgets
//
//  Created by Gas Town on 2026-01-26.
//

import SwiftUI
import WidgetKit

/// Main entry point for the Adjutant widget extension bundle.
/// This bundle will contain Live Activity widgets and home screen widgets
/// for displaying Gas Town status information.
@main
struct AdjutantWidgetsBundle: WidgetBundle {
    var body: some Widget {
        // Live Activity for Gas Town status on Lock Screen and Dynamic Island
        AdjutantLiveActivity()

        // Home screen widget (placeholder for now)
        AdjutantPlaceholderWidget()
    }
}

/// Placeholder widget that will be replaced with actual implementations.
/// This ensures the bundle compiles and runs while widgets are being developed.
struct AdjutantPlaceholderWidget: Widget {
    let kind: String = "AdjutantPlaceholderWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PlaceholderProvider()) { entry in
            PlaceholderWidgetView(entry: entry)
        }
        .configurationDisplayName("Adjutant")
        .description("Gas Town status at a glance.")
        .supportedFamilies([.systemSmall])
    }
}

struct PlaceholderEntry: TimelineEntry {
    let date: Date
}

struct PlaceholderProvider: TimelineProvider {
    func placeholder(in context: Context) -> PlaceholderEntry {
        PlaceholderEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (PlaceholderEntry) -> Void) {
        completion(PlaceholderEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlaceholderEntry>) -> Void) {
        let entry = PlaceholderEntry(date: Date())
        let timeline = Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600)))
        completion(timeline)
    }
}

struct PlaceholderWidgetView: View {
    var entry: PlaceholderEntry

    var body: some View {
        VStack {
            Image(systemName: "terminal")
                .font(.largeTitle)
            Text("Adjutant")
                .font(.caption)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}
