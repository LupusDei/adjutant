import SwiftUI
import AdjutantKit

/// Main dependency graph view with pan/zoom gestures.
/// Uses a ZStack with Canvas edges underneath and SwiftUI node views on top.
struct DependencyGraphView: View {
    @StateObject private var viewModel = DependencyGraphViewModel()
    @Environment(\.crtTheme) private var theme

    // MARK: - Gesture State

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        ZStack {
            CRTTheme.Background.screen

            if viewModel.isLoading && viewModel.graphNodes.isEmpty {
                loadingView
            } else if let error = viewModel.error {
                errorView(error)
            } else if viewModel.graphNodes.isEmpty {
                emptyView
            } else {
                graphContent
            }
        }
        .task {
            await viewModel.fetchGraph()
        }
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
                        width: DependencyGraphViewModel.nodeWidth,
                        height: DependencyGraphViewModel.nodeHeight
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
            .drawingGroup() // GPU-accelerated compositing for smooth scrolling
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
                    .background(CRTTheme.Background.panel.opacity(0.9))
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
                    .cornerRadius(CRTTheme.CornerRadius.md)
            }

            // Critical path toggle
            Button {
                viewModel.showCriticalPath.toggle()
                if viewModel.showCriticalPath {
                    viewModel.computeCriticalPath()
                } else {
                    // Reset critical path flags
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
                            : CRTTheme.Background.panel.opacity(0.9)
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
                    .background(CRTTheme.Background.panel.opacity(0.9))
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
                    .cornerRadius(CRTTheme.CornerRadius.md)
            }

            // Node count
            Text("\(viewModel.graphNodes.count)")
                .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                .foregroundColor(theme.dim)
                .frame(width: 32, height: 20)
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
                scale = min(max(newScale, 0.3), 3.0) // Clamp between 0.3x and 3x
            }
            .onEnded { _ in
                lastScale = scale
            }
    }

    // MARK: - Position Helpers

    /// Computes the screen position for a node, centered in the view.
    private func nodePosition(_ node: BeadGraphNode, center: CGPoint) -> CGPoint {
        CGPoint(
            x: center.x + node.position.x,
            y: center.y + node.position.y
        )
    }

    /// Returns all node positions offset to screen coordinates for the edge canvas.
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
            CRTText("LOADING DEPENDENCY GRAPH...", style: .body, color: theme.dim)
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
            CRTText("No dependency relationships found between beads", style: .body, color: theme.dim.opacity(0.7))
        }
    }
}

// MARK: - Preview

#Preview("Dependency Graph") {
    DependencyGraphView()
}
