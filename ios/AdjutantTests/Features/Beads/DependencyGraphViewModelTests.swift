import XCTest
@testable import AdjutantUI
@testable import AdjutantKit

@MainActor
final class DependencyGraphViewModelTests: XCTestCase {

    // MARK: - Helpers

    /// Creates a simple graph with a root epic and two child tasks.
    ///
    /// Structure:
    ///   epic-001 (root)
    ///     |-- task-001
    ///     |-- task-002
    private func makeSimpleGraph() -> ([GraphNodeInfo], [GraphEdgeInfo]) {
        let nodes = [
            GraphNodeInfo(id: "epic-001", title: "Root Epic", status: "open", type: "epic", priority: 1, assignee: nil, source: "town"),
            GraphNodeInfo(id: "task-001", title: "First Task", status: "in_progress", type: "task", priority: 2, assignee: "crew/alice", source: "town"),
            GraphNodeInfo(id: "task-002", title: "Second Task", status: "open", type: "task", priority: 3, assignee: nil, source: "town"),
        ]
        let edges = [
            GraphEdgeInfo(issueId: "epic-001", dependsOnId: "task-001", type: "parent"),
            GraphEdgeInfo(issueId: "epic-001", dependsOnId: "task-002", type: "parent"),
        ]
        return (nodes, edges)
    }

    /// Creates a chain graph: A -> B -> C -> D (linear dependency).
    private func makeChainGraph() -> ([GraphNodeInfo], [GraphEdgeInfo]) {
        let nodes = [
            GraphNodeInfo(id: "a", title: "Node A", status: "open", type: "epic", priority: 0, assignee: nil, source: "town"),
            GraphNodeInfo(id: "b", title: "Node B", status: "open", type: "task", priority: 1, assignee: nil, source: "town"),
            GraphNodeInfo(id: "c", title: "Node C", status: "open", type: "task", priority: 2, assignee: nil, source: "town"),
            GraphNodeInfo(id: "d", title: "Node D", status: "open", type: "task", priority: 3, assignee: nil, source: "town"),
        ]
        let edges = [
            GraphEdgeInfo(issueId: "a", dependsOnId: "b", type: "parent"),
            GraphEdgeInfo(issueId: "b", dependsOnId: "c", type: "parent"),
            GraphEdgeInfo(issueId: "c", dependsOnId: "d", type: "parent"),
        ]
        return (nodes, edges)
    }

    /// Creates a diamond graph:
    ///     A
    ///    / \
    ///   B   C
    ///    \ /
    ///     D
    private func makeDiamondGraph() -> ([GraphNodeInfo], [GraphEdgeInfo]) {
        let nodes = [
            GraphNodeInfo(id: "a", title: "Node A", status: "open", type: "epic", priority: 0, assignee: nil, source: "town"),
            GraphNodeInfo(id: "b", title: "Node B", status: "in_progress", type: "task", priority: 1, assignee: nil, source: "town"),
            GraphNodeInfo(id: "c", title: "Node C", status: "open", type: "task", priority: 1, assignee: nil, source: "town"),
            GraphNodeInfo(id: "d", title: "Node D", status: "open", type: "task", priority: 2, assignee: nil, source: "town"),
        ]
        let edges = [
            GraphEdgeInfo(issueId: "a", dependsOnId: "b", type: "parent"),
            GraphEdgeInfo(issueId: "a", dependsOnId: "c", type: "parent"),
            GraphEdgeInfo(issueId: "b", dependsOnId: "d", type: "parent"),
            GraphEdgeInfo(issueId: "c", dependsOnId: "d", type: "parent"),
        ]
        return (nodes, edges)
    }

    // MARK: - Initial State Tests

    func testInitialState() {
        let vm = DependencyGraphViewModel()
        XCTAssertTrue(vm.graphNodes.isEmpty, "graphNodes should start empty")
        XCTAssertTrue(vm.graphEdges.isEmpty, "graphEdges should start empty")
        XCTAssertFalse(vm.isLoading, "Should not be loading initially")
        XCTAssertNil(vm.error, "Should have no error initially")
        XCTAssertNil(vm.selectedNodeId, "No node should be selected initially")
        XCTAssertFalse(vm.showCriticalPath, "Critical path should be off initially")
    }

    // MARK: - Layout Algorithm: Layer Assignment Tests

    func testRootNodesGetLayerZero() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeSimpleGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        let rootNode = vm.graphNodes.first { $0.id == "epic-001" }
        XCTAssertNotNil(rootNode, "Root node should exist")
        XCTAssertEqual(rootNode?.layer, 0, "Root node should have layer 0")
    }

    func testChildNodesGetLayerParentPlusOne() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeSimpleGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        let task1 = vm.graphNodes.first { $0.id == "task-001" }
        let task2 = vm.graphNodes.first { $0.id == "task-002" }
        XCTAssertEqual(task1?.layer, 1, "Child nodes should have layer = parent + 1")
        XCTAssertEqual(task2?.layer, 1, "Child nodes should have layer = parent + 1")
    }

    func testChainGraphLayerAssignment() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeChainGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        let nodeA = vm.graphNodes.first { $0.id == "a" }
        let nodeB = vm.graphNodes.first { $0.id == "b" }
        let nodeC = vm.graphNodes.first { $0.id == "c" }
        let nodeD = vm.graphNodes.first { $0.id == "d" }

        XCTAssertEqual(nodeA?.layer, 0, "Root A should be layer 0")
        XCTAssertEqual(nodeB?.layer, 1, "B should be layer 1")
        XCTAssertEqual(nodeC?.layer, 2, "C should be layer 2")
        XCTAssertEqual(nodeD?.layer, 3, "D should be layer 3")
    }

    func testDiamondGraphLayerAssignment() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeDiamondGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        let nodeA = vm.graphNodes.first { $0.id == "a" }
        let nodeB = vm.graphNodes.first { $0.id == "b" }
        let nodeC = vm.graphNodes.first { $0.id == "c" }
        let nodeD = vm.graphNodes.first { $0.id == "d" }

        XCTAssertEqual(nodeA?.layer, 0, "A should be layer 0")
        XCTAssertEqual(nodeB?.layer, 1, "B should be layer 1")
        XCTAssertEqual(nodeC?.layer, 1, "C should be layer 1")
        // D is a child of both B and C (both at layer 1), so D should be at layer 2
        XCTAssertEqual(nodeD?.layer, 2, "D should be layer 2 (max parent layer + 1)")
    }

    // MARK: - Layout Algorithm: Position Tests

    func testNodePositionsDontOverlap() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeSimpleGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        // Check no two nodes occupy the same position
        for i in 0..<vm.graphNodes.count {
            for j in (i + 1)..<vm.graphNodes.count {
                let posA = vm.graphNodes[i].position
                let posB = vm.graphNodes[j].position
                // Nodes should not overlap (accounting for node dimensions)
                let dx = abs(posA.x - posB.x)
                let dy = abs(posA.y - posB.y)
                let overlaps = dx < DependencyGraphViewModel.nodeWidth && dy < DependencyGraphViewModel.nodeHeight
                XCTAssertFalse(overlaps,
                    "Nodes \(vm.graphNodes[i].id) and \(vm.graphNodes[j].id) should not overlap. " +
                    "Positions: \(posA) vs \(posB)")
            }
        }
    }

    func testNodesInSameLayerHaveSameYPosition() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeSimpleGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        // task-001 and task-002 should be in the same layer and have the same Y position
        let task1 = vm.graphNodes.first { $0.id == "task-001" }
        let task2 = vm.graphNodes.first { $0.id == "task-002" }
        XCTAssertNotNil(task1)
        XCTAssertNotNil(task2)
        XCTAssertEqual(task1!.position.y, task2!.position.y, accuracy: 0.1,
            "Nodes in the same layer should have the same Y position")
    }

    func testChildLayerIsBelowParentLayer() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeSimpleGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        let root = vm.graphNodes.first { $0.id == "epic-001" }
        let child = vm.graphNodes.first { $0.id == "task-001" }
        XCTAssertNotNil(root)
        XCTAssertNotNil(child)
        XCTAssertGreaterThan(child!.position.y, root!.position.y,
            "Child layer should be positioned below parent layer (larger Y)")
    }

    // MARK: - Edge Processing Tests

    func testEdgesAreCorrectlyStored() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeSimpleGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        XCTAssertEqual(vm.graphEdges.count, 2, "Should have 2 edges")
        XCTAssertTrue(vm.graphEdges.contains { $0.fromId == "epic-001" && $0.toId == "task-001" })
        XCTAssertTrue(vm.graphEdges.contains { $0.fromId == "epic-001" && $0.toId == "task-002" })
    }

    // MARK: - Critical Path Tests

    func testCriticalPathComputationOnChain() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeChainGraph()

        vm.computeLayout(nodes: nodes, edges: edges)
        vm.computeCriticalPath()

        // In a linear chain of all-open nodes, all should be on the critical path
        let criticalNodes = vm.graphNodes.filter { $0.isCriticalPath }
        XCTAssertEqual(criticalNodes.count, nodes.count,
            "All nodes in a linear chain should be on the critical path")

        let criticalEdges = vm.graphEdges.filter { $0.isCriticalPath }
        XCTAssertEqual(criticalEdges.count, edges.count,
            "All edges in a linear chain should be on the critical path")
    }

    func testCriticalPathExcludesClosedNodes() {
        let vm = DependencyGraphViewModel()
        // Create a chain where some nodes are closed
        let nodes = [
            GraphNodeInfo(id: "a", title: "Node A", status: "open", type: "epic", priority: 0, assignee: nil, source: "town"),
            GraphNodeInfo(id: "b", title: "Node B", status: "closed", type: "task", priority: 1, assignee: nil, source: "town"),
            GraphNodeInfo(id: "c", title: "Node C", status: "open", type: "task", priority: 2, assignee: nil, source: "town"),
        ]
        let edges = [
            GraphEdgeInfo(issueId: "a", dependsOnId: "b", type: "parent"),
            GraphEdgeInfo(issueId: "a", dependsOnId: "c", type: "parent"),
        ]

        vm.computeLayout(nodes: nodes, edges: edges)
        vm.computeCriticalPath()

        let closedNode = vm.graphNodes.first { $0.id == "b" }
        XCTAssertFalse(closedNode?.isCriticalPath ?? true,
            "Closed nodes should not be on the critical path")
    }

    // MARK: - Empty Graph Tests

    func testEmptyGraphHandling() {
        let vm = DependencyGraphViewModel()
        let nodes: [GraphNodeInfo] = []
        let edges: [GraphEdgeInfo] = []

        vm.computeLayout(nodes: nodes, edges: edges)

        XCTAssertTrue(vm.graphNodes.isEmpty, "Should handle empty graph gracefully")
        XCTAssertTrue(vm.graphEdges.isEmpty, "Should handle empty edges gracefully")
    }

    func testSingleNodeGraphHandling() {
        let vm = DependencyGraphViewModel()
        let nodes = [
            GraphNodeInfo(id: "solo", title: "Solo Node", status: "open", type: "task", priority: 1, assignee: nil, source: "town"),
        ]
        let edges: [GraphEdgeInfo] = []

        vm.computeLayout(nodes: nodes, edges: edges)

        XCTAssertEqual(vm.graphNodes.count, 1, "Should have 1 node")
        XCTAssertEqual(vm.graphNodes.first?.layer, 0, "Solo node should be at layer 0")
    }

    // MARK: - Disconnected Graph Tests

    func testDisconnectedNodesAreAllRoots() {
        let vm = DependencyGraphViewModel()
        let nodes = [
            GraphNodeInfo(id: "x", title: "X", status: "open", type: "task", priority: 1, assignee: nil, source: "town"),
            GraphNodeInfo(id: "y", title: "Y", status: "open", type: "task", priority: 2, assignee: nil, source: "town"),
            GraphNodeInfo(id: "z", title: "Z", status: "open", type: "task", priority: 3, assignee: nil, source: "town"),
        ]
        let edges: [GraphEdgeInfo] = []

        vm.computeLayout(nodes: nodes, edges: edges)

        XCTAssertTrue(vm.graphNodes.allSatisfy { $0.layer == 0 },
            "All disconnected nodes should be at layer 0")
    }

    // MARK: - Node Count Integrity

    func testAllInputNodesArePresent() {
        let vm = DependencyGraphViewModel()
        let (nodes, edges) = makeDiamondGraph()

        vm.computeLayout(nodes: nodes, edges: edges)

        XCTAssertEqual(vm.graphNodes.count, nodes.count,
            "All input nodes should be present in the layout")

        let inputIds = Set(nodes.map { $0.id })
        let outputIds = Set(vm.graphNodes.map { $0.id })
        XCTAssertEqual(inputIds, outputIds, "Node IDs should match exactly")
    }

    // MARK: - Selection Tests

    func testNodeSelection() {
        let vm = DependencyGraphViewModel()
        XCTAssertNil(vm.selectedNodeId)

        vm.selectedNodeId = "epic-001"
        XCTAssertEqual(vm.selectedNodeId, "epic-001")

        vm.selectedNodeId = nil
        XCTAssertNil(vm.selectedNodeId)
    }

    // MARK: - Critical Path Toggle Tests

    func testCriticalPathToggle() {
        let vm = DependencyGraphViewModel()
        XCTAssertFalse(vm.showCriticalPath)

        vm.showCriticalPath = true
        XCTAssertTrue(vm.showCriticalPath)

        vm.showCriticalPath = false
        XCTAssertFalse(vm.showCriticalPath)
    }

    // MARK: - BeadInfo Conversion Tests

    func testGraphNodeInfoToBeadGraphNode() {
        let vm = DependencyGraphViewModel()
        let nodes = [
            GraphNodeInfo(id: "test-001", title: "Test", status: "in_progress", type: "task", priority: 2, assignee: "alice", source: "town"),
        ]
        let edges: [GraphEdgeInfo] = []

        vm.computeLayout(nodes: nodes, edges: edges)

        let node = vm.graphNodes.first
        XCTAssertNotNil(node)
        XCTAssertEqual(node?.id, "test-001")
        XCTAssertEqual(node?.nodeInfo.title, "Test")
        XCTAssertEqual(node?.nodeInfo.status, "in_progress")
        XCTAssertEqual(node?.nodeInfo.type, "task")
        XCTAssertEqual(node?.nodeInfo.priority, 2)
        XCTAssertEqual(node?.nodeInfo.assignee, "alice")
    }

    // MARK: - Multiple Root Nodes Tests

    func testMultipleRootNodesLayout() {
        let vm = DependencyGraphViewModel()
        let nodes = [
            GraphNodeInfo(id: "root1", title: "Root 1", status: "open", type: "epic", priority: 0, assignee: nil, source: "town"),
            GraphNodeInfo(id: "root2", title: "Root 2", status: "open", type: "epic", priority: 0, assignee: nil, source: "town"),
            GraphNodeInfo(id: "child1", title: "Child 1", status: "open", type: "task", priority: 1, assignee: nil, source: "town"),
        ]
        let edges = [
            GraphEdgeInfo(issueId: "root1", dependsOnId: "child1", type: "parent"),
        ]

        vm.computeLayout(nodes: nodes, edges: edges)

        let root1 = vm.graphNodes.first { $0.id == "root1" }
        let root2 = vm.graphNodes.first { $0.id == "root2" }
        let child1 = vm.graphNodes.first { $0.id == "child1" }

        XCTAssertEqual(root1?.layer, 0, "root1 should be at layer 0")
        XCTAssertEqual(root2?.layer, 0, "root2 should be at layer 0")
        XCTAssertEqual(child1?.layer, 1, "child1 should be at layer 1")
    }
}
