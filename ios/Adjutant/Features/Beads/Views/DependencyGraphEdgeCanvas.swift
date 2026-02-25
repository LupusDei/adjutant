import SwiftUI

/// Canvas view that draws bezier curve edges between nodes in the dependency graph.
/// Uses SwiftUI Canvas for performant rendering of potentially many edges.
struct DependencyGraphEdgeCanvas: View {
    let edges: [BeadGraphEdge]
    let nodePositions: [String: CGPoint]
    let nodeSize: CGSize

    /// Arrow head size in points
    private let arrowSize: CGFloat = 6

    var body: some View {
        Canvas { context, size in
            for edge in edges {
                guard let from = nodePositions[edge.fromId],
                      let to = nodePositions[edge.toId] else { continue }

                let lineWidth: CGFloat = edge.isCriticalPath ? 3 : 1.5
                let opacity: Double = edge.isCriticalPath ? 1.0 : 0.6
                let color = edge.isCriticalPath
                    ? Color(red: 0, green: 1, blue: 0) // #00ff00 bright green
                    : Color(red: 0, green: 0.667, blue: 0) // #00aa00 dim green

                // Start from bottom center of 'from' node
                let startPoint = CGPoint(
                    x: from.x,
                    y: from.y + nodeSize.height / 2
                )

                // End at top center of 'to' node
                let endPoint = CGPoint(
                    x: to.x,
                    y: to.y - nodeSize.height / 2
                )

                // Draw bezier curve
                var path = Path()
                path.move(to: startPoint)

                let controlOffset = (endPoint.y - startPoint.y) * 0.5
                let control1 = CGPoint(
                    x: startPoint.x,
                    y: startPoint.y + controlOffset
                )
                let control2 = CGPoint(
                    x: endPoint.x,
                    y: endPoint.y - controlOffset
                )

                path.addCurve(
                    to: endPoint,
                    control1: control1,
                    control2: control2
                )

                context.stroke(
                    path,
                    with: .color(color.opacity(opacity)),
                    lineWidth: lineWidth
                )

                // Draw arrow head at the target end
                drawArrowHead(
                    context: &context,
                    at: endPoint,
                    from: control2,
                    color: color.opacity(opacity),
                    size: arrowSize
                )
            }
        }
    }

    /// Draws a small triangular arrow head at the given point.
    private func drawArrowHead(
        context: inout GraphicsContext,
        at point: CGPoint,
        from controlPoint: CGPoint,
        color: Color,
        size: CGFloat
    ) {
        // Calculate direction vector
        let dx = point.x - controlPoint.x
        let dy = point.y - controlPoint.y
        let length = sqrt(dx * dx + dy * dy)
        guard length > 0 else { return }

        let unitX = dx / length
        let unitY = dy / length

        // Perpendicular vector
        let perpX = -unitY
        let perpY = unitX

        // Arrow head points
        let left = CGPoint(
            x: point.x - unitX * size + perpX * size * 0.5,
            y: point.y - unitY * size + perpY * size * 0.5
        )
        let right = CGPoint(
            x: point.x - unitX * size - perpX * size * 0.5,
            y: point.y - unitY * size - perpY * size * 0.5
        )

        var arrowPath = Path()
        arrowPath.move(to: point)
        arrowPath.addLine(to: left)
        arrowPath.addLine(to: right)
        arrowPath.closeSubpath()

        context.fill(arrowPath, with: .color(color))
    }
}
