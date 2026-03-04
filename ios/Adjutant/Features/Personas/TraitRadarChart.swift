import SwiftUI
import AdjutantKit

/// A 4-point diamond radar chart showing category strengths.
/// Axes: ENG (top), QUA (right), CRF (bottom), PRD (left).
struct TraitRadarChart: View {
    @Environment(\.crtTheme) private var theme

    let traits: TraitValues
    let size: CGFloat

    init(traits: TraitValues, size: CGFloat = 60) {
        self.traits = traits
        self.size = size
    }

    /// Normalized strengths for each category (0.0-1.0)
    private var strengths: [Double] {
        TraitCategory.allCases.map { traits.categoryStrength(for: $0) }
    }

    /// Category short labels in order: ENG, QUA, PRD, CRF
    private var labels: [String] {
        TraitCategory.allCases.map { $0.shortLabel }
    }

    var body: some View {
        ZStack {
            // Background diamond outline
            diamondPath(scale: 1.0)
                .stroke(theme.dim.opacity(0.3), lineWidth: 1)

            // Mid-level guide
            diamondPath(scale: 0.5)
                .stroke(theme.dim.opacity(0.15), lineWidth: 0.5)

            // Filled area
            dataPath
                .fill(theme.primary.opacity(0.15))

            dataPath
                .stroke(theme.primary, lineWidth: 1.5)
                .crtGlow(color: theme.primary, radius: 3, intensity: 0.3)

            // Data points
            ForEach(0..<4, id: \.self) { i in
                let point = pointOnAxis(index: i, value: strengths[i])
                Circle()
                    .fill(theme.primary)
                    .frame(width: 4, height: 4)
                    .position(point)
            }

            // Axis labels
            ForEach(0..<4, id: \.self) { i in
                let labelPoint = labelPosition(index: i)
                Text(labels[i])
                    .font(CRTTheme.Typography.font(size: 7, weight: .bold))
                    .tracking(0.3)
                    .foregroundColor(theme.dim)
                    .position(labelPoint)
            }
        }
        .frame(width: size, height: size)
    }

    // MARK: - Geometry

    private var center: CGPoint {
        CGPoint(x: size / 2, y: size / 2)
    }

    private var radius: CGFloat {
        size * 0.35
    }

    /// Returns a point on the given axis at the given normalized value.
    /// Axes: 0=top(ENG), 1=right(QUA), 2=bottom(CRF), 3=left(PRD)
    private func pointOnAxis(index: Int, value: Double) -> CGPoint {
        let clamped = max(0.05, value) // minimum visible size
        let r = radius * clamped
        switch index {
        case 0: return CGPoint(x: center.x, y: center.y - r)           // top
        case 1: return CGPoint(x: center.x + r, y: center.y)           // right
        case 2: return CGPoint(x: center.x, y: center.y + r)           // bottom
        case 3: return CGPoint(x: center.x - r, y: center.y)           // left
        default: return center
        }
    }

    /// Label positions offset slightly beyond the diamond outline
    private func labelPosition(index: Int) -> CGPoint {
        let labelOffset = radius + 10
        switch index {
        case 0: return CGPoint(x: center.x, y: center.y - labelOffset)
        case 1: return CGPoint(x: center.x + labelOffset, y: center.y)
        case 2: return CGPoint(x: center.x, y: center.y + labelOffset)
        case 3: return CGPoint(x: center.x - labelOffset, y: center.y)
        default: return center
        }
    }

    /// Diamond path at a given scale (0.0-1.0)
    private func diamondPath(scale: CGFloat) -> Path {
        Path { path in
            let r = radius * scale
            path.move(to: CGPoint(x: center.x, y: center.y - r))
            path.addLine(to: CGPoint(x: center.x + r, y: center.y))
            path.addLine(to: CGPoint(x: center.x, y: center.y + r))
            path.addLine(to: CGPoint(x: center.x - r, y: center.y))
            path.closeSubpath()
        }
    }

    /// The data path connecting all 4 axis values
    private var dataPath: Path {
        Path { path in
            let points = (0..<4).map { pointOnAxis(index: $0, value: strengths[$0]) }
            guard let first = points.first else { return }
            path.move(to: first)
            for point in points.dropFirst() {
                path.addLine(to: point)
            }
            path.closeSubpath()
        }
    }
}

// MARK: - Preview

#Preview("TraitRadarChart") {
    VStack(spacing: 20) {
        // Sentinel: QA heavy
        TraitRadarChart(
            traits: TraitValues(
                architectureFocus: 4, qaScalability: 6,
                qaCorrectness: 18, testingUnit: 16,
                testingAcceptance: 14, codeReview: 10
            ),
            size: 80
        )

        // Architect: Engineering heavy
        TraitRadarChart(
            traits: TraitValues(
                architectureFocus: 18, modularArchitecture: 16,
                technicalDepth: 14
            ),
            size: 80
        )

        // Balanced
        TraitRadarChart(
            traits: TraitValues(
                architectureFocus: 8, productDesign: 8,
                uiuxFocus: 8, qaScalability: 8,
                qaCorrectness: 8, testingUnit: 8,
                testingAcceptance: 8, modularArchitecture: 8,
                businessObjectives: 8, technicalDepth: 8,
                codeReview: 8, documentation: 8
            ),
            size: 80
        )
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
