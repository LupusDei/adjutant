import SwiftUI
import AdjutantKit

/// Timeline view displaying agent activity events in reverse chronological order.
/// Supports filtering by agent and event type, with pull-to-refresh and pagination.
struct TimelineView: View {
    @StateObject private var viewModel = TimelineViewModel()
    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            headerView
            filterBar
            content
        }
        .background(theme.background.screen)
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                CRTText("ACTIVITY TIMELINE", style: .header)
                    .crtGlow(color: theme.primary, radius: 4, intensity: 0.4)
            }

            Spacer()

            // Event count
            if !viewModel.events.isEmpty {
                BadgeView("\(viewModel.events.count) EVENTS", style: .status(.success))
            }

            // Refresh button
            Button {
                Task<Void, Never> {
                    await viewModel.refresh()
                }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(theme.primary)
                    .rotationEffect(.degrees(viewModel.isLoading ? 360 : 0))
                    .animation(
                        viewModel.isLoading ?
                            .linear(duration: 1).repeatForever(autoreverses: false) :
                            .default,
                        value: viewModel.isLoading
                    )
            }
            .disabled(viewModel.isLoading)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.background.panel)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                // Agent filter
                if !viewModel.agentOptions.isEmpty {
                    Menu {
                        Button("ALL AGENTS") {
                            viewModel.setAgentFilter(nil)
                        }
                        ForEach(viewModel.agentOptions, id: \.self) { agent in
                            Button(agent.uppercased()) {
                                viewModel.setAgentFilter(agent)
                            }
                        }
                    } label: {
                        filterChip(
                            label: viewModel.selectedAgent?.uppercased() ?? "ALL AGENTS",
                            icon: "person.fill",
                            isActive: viewModel.selectedAgent != nil
                        )
                    }
                }

                // Time range picker
                Menu {
                    ForEach(TimelineViewModel.TimeRangeOption.allCases) { option in
                        Button(option.label) {
                            viewModel.selectedTimeRange = option
                        }
                    }
                } label: {
                    filterChip(
                        label: viewModel.selectedTimeRange == .all
                            ? "ALL TIME"
                            : "LAST \(viewModel.selectedTimeRange.label)",
                        icon: "clock",
                        isActive: viewModel.selectedTimeRange != .all
                    )
                }

                // Event type filter chips
                ForEach(TimelineViewModel.eventTypes, id: \.value) { eventType in
                    Button {
                        if viewModel.selectedEventType == eventType.value {
                            viewModel.setEventTypeFilter(nil)
                        } else {
                            viewModel.setEventTypeFilter(eventType.value)
                        }
                    } label: {
                        filterChip(
                            label: eventType.label,
                            icon: iconForEventType(eventType.value),
                            isActive: viewModel.selectedEventType == eventType.value
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .background(theme.background.elevated)
    }

    private func filterChip(label: String, icon: String, isActive: Bool) -> some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            Image(systemName: icon)
                .font(.system(size: 10))
            Text(label)
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .tracking(0.5)
        }
        .foregroundColor(isActive ? theme.bright : theme.dim)
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xxs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(isActive ? theme.primary.opacity(0.15) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(
                    isActive ? theme.primary : theme.primary.opacity(0.3),
                    lineWidth: 1
                )
        )
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.events.isEmpty {
            loadingView
        } else if let errorMessage = viewModel.errorMessage {
            errorView(errorMessage)
        } else if viewModel.events.isEmpty {
            emptyView
        } else {
            eventList
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                .scaleEffect(1.5)
            CRTText("SCANNING TIMELINE...", style: .body, color: theme.dim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(CRTTheme.State.error)
                .crtGlow(color: CRTTheme.State.error, radius: 8, intensity: 0.4)

            CRTText("TIMELINE ERROR", style: .header, color: CRTTheme.State.error)
            CRTText(message, style: .body, color: theme.dim)

            Button {
                viewModel.clearError()
                Task<Void, Never> {
                    await viewModel.refresh()
                }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "arrow.clockwise")
                    Text("RETRY")
                }
                .font(CRTTheme.Typography.font(size: 14, weight: .medium))
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.lg)
                .padding(.vertical, CRTTheme.Spacing.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .stroke(theme.primary, lineWidth: 1)
                )
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()

            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)
                .crtGlow(color: theme.primary, radius: 8, intensity: 0.2)

            CRTText("NO EVENTS", style: .header, color: theme.dim)
            CRTText(
                viewModel.selectedAgent != nil || viewModel.selectedEventType != nil
                    ? "No events match current filters"
                    : "No agent activity recorded yet",
                style: .body,
                color: theme.dim.opacity(0.7)
            )

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var eventList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(viewModel.events) { event in
                    TimelineRowView(event: event)
                }

                if viewModel.hasMore {
                    loadMoreButton
                }
            }
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    private var loadMoreButton: some View {
        Button {
            Task<Void, Never> {
                await viewModel.loadMore()
            }
        } label: {
            HStack(spacing: CRTTheme.Spacing.xs) {
                if viewModel.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                        .scaleEffect(0.8)
                } else {
                    Image(systemName: "arrow.down")
                        .font(.system(size: 12))
                }
                Text("LOAD MORE")
                    .font(CRTTheme.Typography.font(size: 12, weight: .medium))
                    .tracking(0.5)
            }
            .foregroundColor(theme.primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, CRTTheme.Spacing.md)
        }
        .disabled(viewModel.isLoading)
    }

    // MARK: - Helpers

    private func iconForEventType(_ type: String) -> String {
        switch type {
        case "status_change": return "arrow.triangle.2.circlepath"
        case "progress_report": return "chart.bar.fill"
        case "announcement": return "megaphone.fill"
        case "message_sent": return "envelope.fill"
        case "bead_updated": return "circle.grid.3x3"
        case "bead_closed": return "checkmark.circle.fill"
        default: return "circle.fill"
        }
    }
}

// MARK: - Preview

#Preview("Timeline View") {
    TimelineView()
}
