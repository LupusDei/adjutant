import SwiftUI
import AdjutantKit

/// Full-screen epic dependency graph view with pan/zoom gestures.
/// Presents a scoped graph showing the epic, its parent (if any), and all descendants.
/// Uses the same node and edge rendering components as the full dependency graph.
struct EpicGraphView: View {
    @StateObject private var viewModel: EpicGraphViewModel
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let epicTitle: String

    // MARK: - Gesture State

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    init(epicId: String, epicTitle: String) {
        _viewModel = StateObject(wrappedValue: EpicGraphViewModel(epicId: epicId))
        self.epicTitle = epicTitle
    }

    var body: some View {
        ZStack {
            theme.background.screen
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Graph content
                if viewModel.isLoading && viewModel.graphNodes.isEmpty {
                    Spacer()
                    loadingView
                    Spacer()
                } else if let error = viewModel.error {
                    Spacer()
                    errorView(error)
                    Spacer()
                } else if viewModel.graphNodes.isEmpty {
                    Spacer()
                    emptyView
                    Spacer()
                } else {
                    graphContent
                }
            }
        }
        .task {
            await viewModel.fetchGraph()
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            // Close button
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(theme.primary)
                    .frame(width: 32, height: 32)
                    .background(theme.background.panel.opacity(0.9))
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
                    .cornerRadius(CRTTheme.CornerRadius.md)
            }
            .accessibilityLabel("Close graph")

            VStack(alignment: .leading, spacing: 2) {
                Text("EPIC GRAPH // \(viewModel.epicId.uppercased())")
                    .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                    .foregroundColor(theme.primary)
                    .tracking(CRTTheme.Typography.letterSpacing)

                if !epicTitle.isEmpty {
                    Text(epicTitle.uppercased())
                        .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                        .foregroundColor(theme.dim)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Refresh button
            Button {
                Task<Void, Never> {
                    await viewModel.fetchGraph()
                }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(theme.primary)
                    .frame(width: 32, height: 32)
                    .background(theme.background.panel.opacity(0.9))
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
                    .cornerRadius(CRTTheme.CornerRadius.md)
            }
            .accessibilityLabel("Refresh graph")
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

    // MARK: - Graph Content

    private var graphContent: some View {
        GeometryReader { geometry in
            let graphCenter = CGPoint(
                x: geometry.size.width / 2,
                y: geometry.size.height / 3
            )

            ZStack {
                // Edge canvas (underneath)
                DependencyGraphEdgeCanvas(
                    edges: viewModel.graphEdges,
                    nodePositions: offsetPositions(center: graphCenter),
                    nodeSize: CGSize(
                        width: EpicGraphViewModel.nodeWidth,
                        height: EpicGraphViewModel.nodeHeight
                    )
                )

                // Node views (on top)
                ForEach(viewModel.graphNodes) { node in
                    let pos = nodePosition(node, center: graphCenter)
                    DependencyGraphNodeView(
                        node: node,
                        isSelected: viewModel.selectedNodeId == node.id
                    )
                    .position(x: pos.x, y: pos.y)
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                            if viewModel.selectedNodeId == node.id {
                                viewModel.selectedNodeId = nil
                            } else {
                                viewModel.selectedNodeId = node.id
                            }
                        }
                    }
                }
            }
            .scaleEffect(scale)
            .offset(offset)
            .drawingGroup()
            .gesture(panGesture)
            .gesture(magnifyGesture)
            .clipped()
        }
        .overlay(alignment: .topTrailing) {
            controlsOverlay
        }
    }

    // MARK: - Controls Overlay

    private var controlsOverlay: some View {
        VStack(spacing: CRTTheme.Spacing.xs) {
            // Zoom reset button
            Button {
                withAnimation(.easeInOut(duration: 0.3)) {
                    scale = 1.0
                    lastScale = 1.0
                    offset = .zero
                    lastOffset = .zero
                }
            } label: {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(theme.primary)
                    .frame(width: 32, height: 32)
                    .background(theme.background.panel.opacity(0.9))
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
                    .cornerRadius(CRTTheme.CornerRadius.md)
            }
            .accessibilityLabel("Reset zoom and position")

            // Critical path toggle
            Button {
                viewModel.showCriticalPath.toggle()
                if viewModel.showCriticalPath {
                    viewModel.computeCriticalPath()
                } else {
                    for i in viewModel.graphNodes.indices {
                        viewModel.graphNodes[i].isCriticalPath = false
                    }
                    for i in viewModel.graphEdges.indices {
                        viewModel.graphEdges[i].isCriticalPath = false
                    }
                }
            } label: {
                Image(systemName: viewModel.showCriticalPath ? "bolt.fill" : "bolt")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(viewModel.showCriticalPath ? theme.bright : theme.dim)
                    .frame(width: 32, height: 32)
                    .background(
                        viewModel.showCriticalPath
                            ? theme.primary.opacity(0.15)
                            : theme.background.panel.opacity(0.9)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(
                                viewModel.showCriticalPath ? theme.primary : theme.primary.opacity(0.4),
                                lineWidth: 1
                            )
                    )
                    .cornerRadius(CRTTheme.CornerRadius.md)
            }
            .accessibilityLabel(viewModel.showCriticalPath ? "Hide critical path" : "Show critical path")

            // Node count
            Text("\(viewModel.graphNodes.count)")
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .foregroundColor(theme.dim)
                .frame(width: 32, height: 20)
                .accessibilityLabel("\(viewModel.graphNodes.count) nodes in graph")
        }
        .padding(CRTTheme.Spacing.sm)
    }

    // MARK: - Gestures

    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }

    private var magnifyGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let newScale = lastScale * value.magnification
                scale = min(max(newScale, 0.3), 3.0)
            }
            .onEnded { _ in
                lastScale = scale
            }
    }

    // MARK: - Position Helpers

    private func nodePosition(_ node: BeadGraphNode, center: CGPoint) -> CGPoint {
        CGPoint(
            x: center.x + node.position.x,
            y: center.y + node.position.y
        )
    }

    private func offsetPositions(center: CGPoint) -> [String: CGPoint] {
        var positions: [String: CGPoint] = [:]
        for node in viewModel.graphNodes {
            positions[node.id] = CGPoint(
                x: center.x + node.position.x,
                y: center.y + node.position.y
            )
        }
        return positions
    }

    // MARK: - State Views

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                .scaleEffect(1.5)
            CRTText("LOADING EPIC GRAPH...", style: .body, color: theme.dim)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(CRTTheme.State.error)

            CRTText("GRAPH LOAD FAILED", style: .header, color: CRTTheme.State.error)
            CRTText(message, style: .body, color: theme.dim)

            Button {
                viewModel.error = nil
                Task<Void, Never> {
                    await viewModel.fetchGraph()
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
        }
    }

    private var emptyView: some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                .font(.system(size: 48))
                .foregroundColor(theme.dim)

            CRTText("NO DEPENDENCIES", style: .header, color: theme.dim)
            CRTText("No dependency relationships found for this epic", style: .body, color: theme.dim.opacity(0.7))
        }
    }
}

// MARK: - Preview

#Preview("Epic Graph") {
    EpicGraphView(epicId: "adj-037", epicTitle: "Scoped Bead Graph")
}
