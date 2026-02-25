import Foundation
import Combine
import AdjutantKit

// MARK: - Graph Display Types

/// A positioned node in the dependency graph, ready for rendering.
struct BeadGraphNode: Identifiable {
    let nodeInfo: GraphNodeInfo
    var position: CGPoint
    var layer: Int
    var isCollapsed: Bool = false
    var isCriticalPath: Bool = false

    var id: String { nodeInfo.id }
}

/// A directed edge in the dependency graph, ready for rendering.
struct BeadGraphEdge: Identifiable {
    let fromId: String
    let toId: String
    let type: String
    var isCriticalPath: Bool = false

    var id: String { "\(fromId)-\(toId)" }
}

// MARK: - ViewModel

/// ViewModel for the bead dependency graph view.
/// Handles fetching graph data, computing layout, and critical path analysis.
@MainActor
class DependencyGraphViewModel: ObservableObject {

    // MARK: - Layout Constants

    /// Width of a graph node in points
    static let nodeWidth: CGFloat = 180
    /// Height of a graph node in points
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

    // MARK: - Dependencies

    private let apiClient: APIClient?

    // MARK: - Initialization

    init(apiClient: APIClient? = nil) {
        self.apiClient = apiClient ?? AppState.shared.apiClient
    }

    // MARK: - Data Fetching

    /// Fetches the beads graph from the API and computes layout.
    func fetchGraph() async {
        guard let apiClient else {
            // Use mock data for preview
            computeLayout(nodes: Self.mockNodes, edges: Self.mockEdges)
            return
        }

        isLoading = true
        error = nil

        do {
            let response = try await apiClient.getBeadsGraph()
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

    // MARK: - Layout Algorithm

    /// Computes the layered graph layout using topological sort and barycentric ordering.
    ///
    /// Steps:
    /// 1. Build adjacency structures (parent -> children, child -> parents)
    /// 2. Identify root nodes (no incoming edges)
    /// 3. BFS/topological traversal to assign layers (depth from root)
    /// 4. Within each layer, order nodes using barycentric heuristic
    /// 5. Compute final positions from layer and order
    func computeLayout(nodes: [GraphNodeInfo], edges: [GraphEdgeInfo]) {
        guard !nodes.isEmpty else {
            graphNodes = []
            graphEdges = []
            return
        }

        // Build adjacency: edge direction is fromId (parent) -> toId (child)
        // In the API: issueId depends on dependsOnId, meaning issueId is the parent
        var childrenOf: [String: [String]] = [:]
        var parentsOf: [String: [String]] = [:]
        let nodeMap = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })

        for edge in edges {
            let parentId = edge.issueId
            let childId = edge.dependsOnId
            childrenOf[parentId, default: []].append(childId)
            parentsOf[childId, default: []].append(parentId)
        }

        // Step 1: Identify root nodes (no parents in the edge set)
        let allIds = Set(nodes.map { $0.id })
        let childIds = Set(parentsOf.keys)
        let rootIds = allIds.subtracting(childIds)

        // Step 2: BFS to assign layers
        var layerAssignment: [String: Int] = [:]
        var queue: [String] = Array(rootIds).sorted() // Sort for determinism
        for rootId in queue {
            layerAssignment[rootId] = 0
        }

        var head = 0
        while head < queue.count {
            let nodeId = queue[head]
            head += 1
            let currentLayer = layerAssignment[nodeId] ?? 0

            for childId in childrenOf[nodeId] ?? [] {
                let existingLayer = layerAssignment[childId] ?? -1
                let newLayer = currentLayer + 1
                if newLayer > existingLayer {
                    layerAssignment[childId] = newLayer
                    // Re-enqueue to propagate deeper layers
                    queue.append(childId)
                }
            }
        }

        // Handle orphan nodes that weren't reached (shouldn't happen with valid data)
        for node in nodes where layerAssignment[node.id] == nil {
            layerAssignment[node.id] = 0
        }

        // Step 3: Group nodes by layer
        var layers: [Int: [String]] = [:]
        for (nodeId, layer) in layerAssignment {
            layers[layer, default: []].append(nodeId)
        }

        // Sort layers for deterministic output
        let sortedLayerKeys = layers.keys.sorted()
        for key in sortedLayerKeys {
            layers[key]?.sort()
        }

        // Step 4: Barycentric ordering (single pass)
        // For each layer after the first, order nodes by the average position
        // of their parents in the previous layer.
        for layerIdx in sortedLayerKeys where layerIdx > 0 {
            guard var layerNodes = layers[layerIdx] else { continue }
            let previousLayer = layers[layerIdx - 1] ?? []

            layerNodes.sort { aId, bId in
                let aBarycenter = barycenter(of: aId, parents: parentsOf[aId] ?? [], inLayer: previousLayer)
                let bBarycenter = barycenter(of: bId, parents: parentsOf[bId] ?? [], inLayer: previousLayer)
                if aBarycenter != bBarycenter {
                    return aBarycenter < bBarycenter
                }
                return aId < bId // Tie-break by ID for determinism
            }

            layers[layerIdx] = layerNodes
        }

        // Step 5: Compute positions
        var resultNodes: [BeadGraphNode] = []
        for layerIdx in sortedLayerKeys {
            let layerNodes = layers[layerIdx] ?? []
            let layerWidth = CGFloat(layerNodes.count) * (Self.nodeWidth + Self.horizontalSpacing) - Self.horizontalSpacing
            let startX = -layerWidth / 2 + Self.nodeWidth / 2

            for (orderIdx, nodeId) in layerNodes.enumerated() {
                guard let nodeInfo = nodeMap[nodeId] else { continue }
                let x = startX + CGFloat(orderIdx) * (Self.nodeWidth + Self.horizontalSpacing)
                let y = CGFloat(layerIdx) * (Self.nodeHeight + Self.verticalSpacing)

                resultNodes.append(BeadGraphNode(
                    nodeInfo: nodeInfo,
                    position: CGPoint(x: x, y: y),
                    layer: layerIdx
                ))
            }
        }

        // Convert edges
        let resultEdges = edges.compactMap { edge -> BeadGraphEdge? in
            // Only include edges where both nodes exist
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

    /// Computes the barycenter (average position index) of a node's parents in their layer.
    private func barycenter(of nodeId: String, parents: [String], inLayer layer: [String]) -> Double {
        guard !parents.isEmpty else { return Double(layer.count) / 2.0 }
        var sum = 0.0
        var count = 0
        for parent in parents {
            if let idx = layer.firstIndex(of: parent) {
                sum += Double(idx)
                count += 1
            }
        }
        return count > 0 ? sum / Double(count) : Double(layer.count) / 2.0
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

        // Find root open nodes (no open parent)
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
            for child in childrenOf[nodeId] ?? [] {
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
        for i in 0..<(longestPath.count - 1) {
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

extension DependencyGraphViewModel {
    static let mockNodes: [GraphNodeInfo] = [
        GraphNodeInfo(id: "adj-001", title: "Root Epic", status: "open", type: "epic", priority: 1, assignee: nil, source: "town"),
        GraphNodeInfo(id: "adj-002", title: "Backend API", status: "in_progress", type: "task", priority: 2, assignee: "crew/alice", source: "town"),
        GraphNodeInfo(id: "adj-003", title: "Frontend UI", status: "open", type: "task", priority: 2, assignee: nil, source: "town"),
        GraphNodeInfo(id: "adj-004", title: "iOS App", status: "open", type: "task", priority: 3, assignee: "crew/bob", source: "town"),
    ]

    static let mockEdges: [GraphEdgeInfo] = [
        GraphEdgeInfo(issueId: "adj-001", dependsOnId: "adj-002", type: "parent"),
        GraphEdgeInfo(issueId: "adj-001", dependsOnId: "adj-003", type: "parent"),
        GraphEdgeInfo(issueId: "adj-001", dependsOnId: "adj-004", type: "parent"),
    ]
}
