import Foundation
import Combine
import AdjutantKit

// MARK: - ViewModel

/// ViewModel for the epic-scoped dependency graph.
/// Fetches graph data scoped to a single epic and its descendants,
/// then computes a top-down tree layout with the epic at the center.
@MainActor
class EpicGraphViewModel: ObservableObject {

    // MARK: - Layout Constants

    /// Width of a graph node in points (matches DependencyGraphViewModel)
    static let nodeWidth: CGFloat = 180
    /// Height of a graph node in points (matches DependencyGraphViewModel)
    static let nodeHeight: CGFloat = 60
    /// Horizontal spacing between nodes in the same layer
    static let horizontalSpacing: CGFloat = 40
    /// Vertical spacing between layers
    static let verticalSpacing: CGFloat = 80

    // MARK: - Published Properties

    /// Positioned graph nodes for rendering
    @Published var graphNodes: [BeadGraphNode] = []
    /// Graph edges for rendering
    @Published var graphEdges: [BeadGraphEdge] = []
    /// Whether a fetch is in progress
    @Published var isLoading = false
    /// Error message from last fetch attempt
    @Published var error: String?
    /// Currently selected node ID
    @Published var selectedNodeId: String?
    /// Whether to highlight the critical path
    @Published var showCriticalPath = false

    // MARK: - Configuration

    /// The epic ID this graph is scoped to
    let epicId: String

    // MARK: - Dependencies

    private let apiClient: APIClient?

    // MARK: - Initialization

    init(epicId: String, apiClient: APIClient? = nil) {
        self.epicId = epicId
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    // MARK: - Data Fetching

    /// Fetches the epic-scoped graph from the API and computes layout.
    func fetchGraph() async {
        guard let apiClient else {
            computeLayout(nodes: Self.mockNodes, edges: Self.mockEdges)
            return
        }

        isLoading = true
        error = nil

        do {
            let response = try await apiClient.getEpicGraph(epicId: epicId)
            computeLayout(nodes: response.nodes, edges: response.edges)
            if showCriticalPath {
                computeCriticalPath()
            }
            isLoading = false
        } catch {
            self.error = "Failed to load graph: \(error.localizedDescription)"
            isLoading = false
        }
    }

    // MARK: - Top-Down Tree Layout Algorithm

    /// Computes a top-down tree layout centered on the target epic.
    ///
    /// Layer assignment:
    /// - Layer -1: Parent of the target epic (if present in the graph)
    /// - Layer 0: The target epic itself
    /// - Layer 1+: Children, grandchildren, etc. via BFS
    ///
    /// Within each layer, nodes are sorted by ID for stable ordering.
    /// Nodes are centered horizontally within their layer.
    func computeLayout(nodes: [GraphNodeInfo], edges: [GraphEdgeInfo]) {
        guard !nodes.isEmpty else {
            graphNodes = []
            graphEdges = []
            return
        }

        let nodeMap = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })

        // Build adjacency from edges.
        // In the beads model: issueId depends on dependsOnId
        // meaning issueId is the parent, dependsOnId is the child.
        // Children of epic X: edges where issueId == X -> dependsOnId values
        // Parent of epic X: edges where dependsOnId == X -> issueId values
        var childrenOf: [String: [String]] = [:]
        var parentsOf: [String: [String]] = [:]

        for edge in edges {
            let parentId = edge.issueId
            let childId = edge.dependsOnId
            childrenOf[parentId, default: []].append(childId)
            parentsOf[childId, default: []].append(parentId)
        }

        // Assign layers
        var layerAssignment: [String: Int] = [:]

        // The target epic is always layer 0
        layerAssignment[epicId] = 0

        // Identify parent(s) of the epic — place at layer -1
        let epicParents = (parentsOf[epicId] ?? []).filter { nodeMap[$0] != nil }
        for parentId in epicParents {
            layerAssignment[parentId] = -1
        }

        // BFS from the epic through children to assign layers 1, 2, 3...
        var queue: [String] = [epicId]
        var head = 0
        while head < queue.count {
            let nodeId = queue[head]
            head += 1
            let currentLayer = layerAssignment[nodeId] ?? 0

            for childId in (childrenOf[nodeId] ?? []).sorted() {
                guard nodeMap[childId] != nil else { continue }
                let newLayer = currentLayer + 1
                let existingLayer = layerAssignment[childId]
                // Only assign if not already assigned or if we found a deeper path
                if existingLayer == nil || newLayer > existingLayer! {
                    layerAssignment[childId] = newLayer
                    queue.append(childId)
                }
            }
        }

        // Handle any orphan nodes not reached by BFS (shouldn't happen with valid scoped data)
        for node in nodes where layerAssignment[node.id] == nil {
            layerAssignment[node.id] = 0
        }

        // Group nodes by layer
        var layers: [Int: [String]] = [:]
        for (nodeId, layer) in layerAssignment {
            layers[layer, default: []].append(nodeId)
        }

        // Sort within each layer by ID for deterministic output
        let sortedLayerKeys = layers.keys.sorted()
        for key in sortedLayerKeys {
            layers[key]?.sort()
        }

        // Compute positions.
        // Normalize so that the minimum layer maps to y=0.
        let minLayer = sortedLayerKeys.first ?? 0

        var resultNodes: [BeadGraphNode] = []
        for layerIdx in sortedLayerKeys {
            let layerNodes = layers[layerIdx] ?? []
            let layerWidth = CGFloat(layerNodes.count) * (Self.nodeWidth + Self.horizontalSpacing) - Self.horizontalSpacing
            let startX = -layerWidth / 2 + Self.nodeWidth / 2

            let normalizedLayer = layerIdx - minLayer

            for (orderIdx, nodeId) in layerNodes.enumerated() {
                guard let nodeInfo = nodeMap[nodeId] else { continue }
                let x = startX + CGFloat(orderIdx) * (Self.nodeWidth + Self.horizontalSpacing)
                let y = CGFloat(normalizedLayer) * (Self.nodeHeight + Self.verticalSpacing)

                resultNodes.append(BeadGraphNode(
                    nodeInfo: nodeInfo,
                    position: CGPoint(x: x, y: y),
                    layer: layerIdx
                ))
            }
        }

        // Convert edges (only include edges where both nodes are present)
        let resultEdges = edges.compactMap { edge -> BeadGraphEdge? in
            guard nodeMap[edge.issueId] != nil, nodeMap[edge.dependsOnId] != nil else { return nil }
            return BeadGraphEdge(
                fromId: edge.issueId,
                toId: edge.dependsOnId,
                type: edge.type
            )
        }

        graphNodes = resultNodes
        graphEdges = resultEdges
    }

    // MARK: - Critical Path

    /// Computes the critical path (longest chain of open/non-closed nodes).
    /// Marks nodes and edges on the critical path with `isCriticalPath = true`.
    func computeCriticalPath() {
        // Reset all critical path flags
        for i in graphNodes.indices {
            graphNodes[i].isCriticalPath = false
        }
        for i in graphEdges.indices {
            graphEdges[i].isCriticalPath = false
        }

        guard !graphNodes.isEmpty else { return }

        // Build adjacency for open nodes only
        let openNodeIds = Set(graphNodes.filter { $0.nodeInfo.status != "closed" }.map { $0.id })

        var childrenOf: [String: [String]] = [:]
        for edge in graphEdges {
            if openNodeIds.contains(edge.fromId) && openNodeIds.contains(edge.toId) {
                childrenOf[edge.fromId, default: []].append(edge.toId)
            }
        }

        // Find root open nodes (no open parent in our edge set)
        let openParentsOf: [String: [String]] = {
            var result: [String: [String]] = [:]
            for edge in graphEdges {
                if openNodeIds.contains(edge.fromId) && openNodeIds.contains(edge.toId) {
                    result[edge.toId, default: []].append(edge.fromId)
                }
            }
            return result
        }()

        let openRoots = openNodeIds.filter { (openParentsOf[$0] ?? []).isEmpty }

        // DFS to find longest path
        var longestPath: [String] = []

        func dfs(nodeId: String, currentPath: [String]) {
            let newPath = currentPath + [nodeId]
            if newPath.count > longestPath.count {
                longestPath = newPath
            }
            for child in (childrenOf[nodeId] ?? []).sorted() {
                dfs(nodeId: child, currentPath: newPath)
            }
        }

        for root in openRoots.sorted() {
            dfs(nodeId: root, currentPath: [])
        }

        // Mark critical path nodes and edges
        let criticalSet = Set(longestPath)
        for i in graphNodes.indices {
            if criticalSet.contains(graphNodes[i].id) {
                graphNodes[i].isCriticalPath = true
            }
        }

        // Mark edges where both endpoints are consecutive on the critical path
        for i in 0..<max(0, longestPath.count - 1) {
            let fromId = longestPath[i]
            let toId = longestPath[i + 1]
            if let edgeIdx = graphEdges.firstIndex(where: { $0.fromId == fromId && $0.toId == toId }) {
                graphEdges[edgeIdx].isCriticalPath = true
            }
        }
    }

    /// Node positions keyed by bead ID for Canvas rendering.
    var nodePositions: [String: CGPoint] {
        Dictionary(uniqueKeysWithValues: graphNodes.map { ($0.id, $0.position) })
    }
}

// MARK: - Mock Data

extension EpicGraphViewModel {
    static let mockNodes: [GraphNodeInfo] = [
        GraphNodeInfo(id: "adj-037", title: "Scoped Bead Graph", status: "open", type: "epic", priority: 1, assignee: nil, source: "adjutant"),
        GraphNodeInfo(id: "adj-037.1", title: "Add API Method", status: "closed", type: "task", priority: 2, assignee: "crew/ios-eng", source: "adjutant"),
        GraphNodeInfo(id: "adj-037.2", title: "Create ViewModel", status: "in_progress", type: "task", priority: 2, assignee: "crew/ios-eng", source: "adjutant"),
        GraphNodeInfo(id: "adj-037.3", title: "Create View", status: "open", type: "task", priority: 2, assignee: nil, source: "adjutant"),
        GraphNodeInfo(id: "adj-037.4", title: "Wire into Detail", status: "open", type: "task", priority: 2, assignee: nil, source: "adjutant"),
    ]

    static let mockEdges: [GraphEdgeInfo] = [
        GraphEdgeInfo(issueId: "adj-037", dependsOnId: "adj-037.1", type: "parent"),
        GraphEdgeInfo(issueId: "adj-037", dependsOnId: "adj-037.2", type: "parent"),
        GraphEdgeInfo(issueId: "adj-037", dependsOnId: "adj-037.3", type: "parent"),
        GraphEdgeInfo(issueId: "adj-037", dependsOnId: "adj-037.4", type: "parent"),
    ]
}
