import SwiftUI
import AdjutantKit

// MARK: - MissionControlMapView

/// Natively-drawn (SwiftUI `Canvas`/`Path`) portfolio coordination map (adj-208.3.3).
///
/// A single Canvas draws every element in one GPU-backed pass (no per-node SwiftUI views → 60fps):
/// the coordinator hub at the base, one stream per project rising to its active-epic node with a
/// completion ring, agent markers, a status beacon, a queued/backlog reservoir, per-project
/// remaining-work badges, and a portfolio header line. All geometry comes from the pure,
/// unit-tested `MissionControlLayout`; all color from the `CRTTheme.Brand` tokens (adj-208.3.1).
///
/// Consumes the real `AdjutantKit` rollup model (`ProjectStreamRollup` / `PortfolioTotals`,
/// adj-208.2.1). NOTE the completion percents are INTEGER 0–100 (backend `Math.round(fraction*100)`),
/// so the ring/arc math divides by 100. View-only in v1 — no tap-to-drill-down.
struct MissionControlMapView: View {
    let projects: [ProjectStreamRollup]
    let totals: PortfolioTotals

    @Environment(\.crtTheme) private var theme

    // MARK: Layout constants
    private let hMargin: CGFloat = 46
    private let topMargin: CGFloat = 92      // header band + beacon + node
    private let baseMargin: CGFloat = 58     // hub inset from the bottom
    private let nodeRadius: CGFloat = 22
    private let ringWidth: CGFloat = 5
    private let hubRadius: CGFloat = 17

    var body: some View {
        Canvas { context, size in
            let xs = MissionControlLayout.streamXPositions(
                count: projects.count, width: size.width, margin: hMargin
            )
            let hub = MissionControlLayout.hubAnchor(size: size, margin: baseMargin)
            let backlog = MissionControlLayout.backlogAnchor(size: size, margin: baseMargin)

            drawBaseline(&context, size: size, hub: hub)

            // Streams first (underlay), then nodes/markers on top.
            for index in projects.indices where index < xs.count {
                let epic = MissionControlLayout.epicNodePosition(
                    streamX: xs[index], size: size, topMargin: topMargin
                )
                drawStream(&context, from: hub, to: epic)
            }
            for (index, project) in projects.enumerated() where index < xs.count {
                let epic = MissionControlLayout.epicNodePosition(
                    streamX: xs[index], size: size, topMargin: topMargin
                )
                drawProject(&context, project: project, at: epic)
            }

            drawHub(&context, at: hub)
            drawBacklog(&context, at: backlog)
            drawHeader(&context, size: size)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .drawingGroup()  // rasterize the whole map once per data change — steady 60fps on scroll
    }

    // MARK: - Baseline

    private func drawBaseline(_ context: inout GraphicsContext, size: CGSize, hub: CGPoint) {
        var line = Path()
        line.move(to: CGPoint(x: hMargin, y: hub.y))
        line.addLine(to: CGPoint(x: size.width - hMargin, y: hub.y))
        context.stroke(line, with: .color(theme.dim.opacity(0.35)), lineWidth: 1)
    }

    // MARK: - Stream

    private func drawStream(_ context: inout GraphicsContext, from hub: CGPoint, to epic: CGPoint) {
        var path = Path()
        path.move(to: hub)
        // Smooth S-curve rising from the base hub to the epic node.
        let dy = (epic.y - hub.y) * 0.5
        path.addCurve(
            to: epic,
            control1: CGPoint(x: hub.x, y: hub.y + dy),
            control2: CGPoint(x: epic.x, y: epic.y - dy)
        )
        context.stroke(
            path,
            with: .linearGradient(
                Gradient(colors: [CRTTheme.Brand.violet.opacity(0.85), CRTTheme.Brand.cyan]),
                startPoint: hub,
                endPoint: epic
            ),
            style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
        )
    }

    // MARK: - Project cluster (node + ring + beacon + name + badge + agents)

    private func drawProject(_ context: inout GraphicsContext, project: ProjectStreamRollup, at epic: CGPoint) {
        // Backend completion is an INTEGER percent (0–100); the ring math wants a 0…1 fraction.
        let percent100 = project.activeEpic?.completionPercent ?? 0
        let fraction = CGFloat(percent100 / 100)

        // Completion ring — dim track + bright progress arc.
        let ringRect = CGRect(
            x: epic.x - nodeRadius, y: epic.y - nodeRadius,
            width: nodeRadius * 2, height: nodeRadius * 2
        )
        context.stroke(Path(ellipseIn: ringRect), with: .color(theme.dim.opacity(0.3)), lineWidth: ringWidth)

        let startAngle: CGFloat = -.pi / 2
        let endAngle = MissionControlLayout.completionArcEndAngle(percent: fraction, startAngle: startAngle)
        var arc = Path()
        arc.addArc(
            center: epic, radius: nodeRadius,
            startAngle: Angle(radians: Double(startAngle)),
            endAngle: Angle(radians: Double(endAngle)),
            clockwise: false
        )
        context.stroke(arc, with: .color(CRTTheme.Brand.cyan), style: StrokeStyle(lineWidth: ringWidth, lineCap: .round))

        // Node fill + completion % label.
        context.fill(Path(ellipseIn: ringRect.insetBy(dx: ringWidth, dy: ringWidth)), with: .color(theme.background.elevated))
        let pctText = Text("\(Int(percent100.rounded()))%")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.cyanText)
        context.draw(pctText, at: epic, anchor: .center)

        // Status beacon — a glowing dot above the node.
        let beaconKey = MissionControlLayout.beaconKey(forStatus: project.status)
        let beacon = CGPoint(x: epic.x, y: epic.y - nodeRadius - 11)
        let beaconDot = Path(ellipseIn: CGRect(x: beacon.x - 5, y: beacon.y - 5, width: 10, height: 10))
        context.fill(Path(ellipseIn: CGRect(x: beacon.x - 8, y: beacon.y - 8, width: 16, height: 16)),
                     with: .color(beaconColor(beaconKey).opacity(0.25)))  // halo
        context.fill(beaconDot, with: .color(beaconColor(beaconKey)))

        // Project name.
        let name = Text(project.name.uppercased())
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundColor(theme.textPrimary)
        context.draw(name, at: CGPoint(x: epic.x, y: epic.y + nodeRadius + 13), anchor: .center)

        // Remaining-work badge — scaled by backlog weight.
        let remaining = project.epicsRemaining + project.openBeadsRemaining
        let scale = MissionControlLayout.remainingBadgeScale(remaining: remaining)
        let badge = Text("\(project.epicsRemaining) EPICS · \(project.openBeadsRemaining) OPEN")
            .font(.system(size: 9 * scale, weight: .medium, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.violetText)
        context.draw(badge, at: CGPoint(x: epic.x, y: epic.y + nodeRadius + 29), anchor: .center)

        // Agent markers — a row of dots just below the badge (cap at 5, then "+N").
        drawAgents(&context, agents: project.agents, centerX: epic.x, y: epic.y + nodeRadius + 46)
    }

    private func drawAgents(_ context: inout GraphicsContext, agents: [ProjectAgent], centerX: CGFloat, y: CGFloat) {
        guard !agents.isEmpty else { return }
        let maxDots = 5
        let shown = min(agents.count, maxDots)
        let spacing: CGFloat = 12
        let totalWidth = CGFloat(shown - 1) * spacing
        var x = centerX - totalWidth / 2
        for i in 0..<shown {
            let dot = Path(ellipseIn: CGRect(x: x - 3.5, y: y - 3.5, width: 7, height: 7))
            context.fill(dot, with: .color(agentColor(agents[i].status)))
            x += spacing
        }
        if agents.count > maxDots {
            let more = Text("+\(agents.count - maxDots)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(theme.dim)
            context.draw(more, at: CGPoint(x: x + 4, y: y), anchor: .leading)
        }
    }

    // MARK: - Hub

    private func drawHub(_ context: inout GraphicsContext, at hub: CGPoint) {
        let rect = CGRect(x: hub.x - hubRadius, y: hub.y - hubRadius, width: hubRadius * 2, height: hubRadius * 2)
        context.fill(Path(ellipseIn: rect.insetBy(dx: -6, dy: -6)), with: .color(CRTTheme.Brand.violet.opacity(0.18)))  // halo
        context.fill(Path(ellipseIn: rect), with: .color(theme.background.elevated))
        context.stroke(Path(ellipseIn: rect), with: .color(CRTTheme.Brand.violet), lineWidth: 2.5)
        let label = Text("ADJ")
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.violetText)
        context.draw(label, at: hub, anchor: .center)
        let caption = Text("COORDINATOR")
            .font(.system(size: 8, weight: .medium, design: .monospaced))
            .foregroundColor(theme.dim)
        context.draw(caption, at: CGPoint(x: hub.x, y: hub.y + hubRadius + 11), anchor: .center)
    }

    // MARK: - Backlog reservoir

    private func drawBacklog(_ context: inout GraphicsContext, at backlog: CGPoint) {
        // A short stack of queued-epic bars reading as work waiting to feed the coordinator.
        let queued = max(0, totals.epicsRemaining)
        let bars = min(queued, 3)
        for i in 0..<max(bars, 1) {
            let w: CGFloat = 26 - CGFloat(i) * 4
            let rect = CGRect(x: backlog.x - w / 2, y: backlog.y - 14 - CGFloat(i) * 6, width: w, height: 4)
            let filled = i < bars
            context.fill(
                Path(roundedRect: rect, cornerRadius: 2),
                with: .color(filled ? CRTTheme.Brand.cyan.opacity(0.7) : theme.dim.opacity(0.3))
            )
        }
        let label = Text(queued > 0 ? "QUEUE +\(queued)" : "QUEUE 0")
            .font(.system(size: 8, weight: .medium, design: .monospaced))
            .foregroundColor(theme.dim)
        context.draw(label, at: CGPoint(x: backlog.x, y: backlog.y + 6), anchor: .center)
    }

    // MARK: - Portfolio header

    private func drawHeader(_ context: inout GraphicsContext, size: CGSize) {
        let title = Text("MISSION CONTROL")
            .font(.system(size: 13, weight: .bold, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.cyanText)
        context.draw(title, at: CGPoint(x: hMargin, y: 22), anchor: .leading)

        let pct = Int(totals.portfolioCompletionPercent.rounded())  // already 0–100
        let stats = Text("\(totals.projects) PROJ · \(pct)% · \(totals.agentsActive) AGENTS · \(totals.epicsRemaining) EPICS · \(totals.openBeadsRemaining) OPEN")
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundColor(theme.textSecondary)
        context.draw(stats, at: CGPoint(x: hMargin, y: 40), anchor: .leading)

        // Attention chips: blocked / needs-input counts, only when non-zero.
        var chipX = size.width - hMargin
        if totals.blocked > 0 {
            chipX = drawChip(&context, text: "\(totals.blocked) BLOCKED", color: CRTTheme.State.error, rightX: chipX, y: 30)
        }
        if totals.needsInput > 0 {
            _ = drawChip(&context, text: "\(totals.needsInput) NEEDS INPUT", color: CRTTheme.State.warning, rightX: chipX, y: 30)
        }
    }

    /// Draws a right-anchored status chip and returns the x at which the next chip (to its left) should end.
    private func drawChip(_ context: inout GraphicsContext, text: String, color: Color, rightX: CGFloat, y: CGFloat) -> CGFloat {
        let label = Text(text)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundColor(color)
        let resolved = context.resolve(label)
        let sz = resolved.measure(in: CGSize(width: 400, height: 40))
        let padding: CGFloat = 8
        let width = sz.width + padding * 2
        let rect = CGRect(x: rightX - width, y: y - 9, width: width, height: 18)
        context.fill(Path(roundedRect: rect, cornerRadius: 4), with: .color(color.opacity(0.14)))
        context.stroke(Path(roundedRect: rect, cornerRadius: 4), with: .color(color.opacity(0.5)), lineWidth: 1)
        context.draw(resolved, at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
        return rect.minX - 8
    }

    // MARK: - Color mapping

    private func beaconColor(_ key: MissionControlLayout.BeaconKey) -> Color {
        switch key {
        case .green:   return CRTTheme.State.success
        case .amber:   return CRTTheme.State.warning
        case .red:     return CRTTheme.State.error
        case .neutral: return theme.dim
        }
    }

    private func agentColor(_ status: String) -> Color {
        switch status.lowercased() {
        case "working": return CRTTheme.State.success
        case "idle":    return CRTTheme.State.info
        case "blocked": return CRTTheme.State.error
        default:        return CRTTheme.State.offline
        }
    }

    // MARK: - Accessibility

    private var accessibilitySummary: String {
        let pct = Int(totals.portfolioCompletionPercent.rounded())
        var parts = ["Mission Control. \(totals.projects) projects, \(pct) percent complete, \(totals.agentsActive) active agents, \(totals.epicsRemaining) epics and \(totals.openBeadsRemaining) open beads remaining."]
        if totals.blocked > 0 { parts.append("\(totals.blocked) blocked.") }
        if totals.needsInput > 0 { parts.append("\(totals.needsInput) need input.") }
        for p in projects {
            let c = Int((p.activeEpic?.completionPercent ?? 0).rounded())
            parts.append("\(p.name): \(p.status.replacingOccurrences(of: "_", with: " ")), \(c) percent, \(p.epicsRemaining) epics and \(p.openBeadsRemaining) beads remaining, \(p.agents.count) agents.")
        }
        return parts.joined(separator: " ")
    }
}

// MARK: - Preview

#if DEBUG
/// Sample portfolio for previews (real `AdjutantKit` rollup types). Percents are 0–100.
private enum MissionControlPreviewData {
    static let projects: [ProjectStreamRollup] = [
        ProjectStreamRollup(
            projectId: "adjutant", name: "Adjutant",
            activeEpic: ActiveEpic(id: "adj-208", title: "Mission Control", completionPercent: 42, closedChildren: 5, totalChildren: 12),
            epicsRemaining: 3, openBeadsRemaining: 14,
            agents: [ProjectAgent(id: "abathur", status: "working"), ProjectAgent(id: "kerrigan", status: "working"), ProjectAgent(id: "raynor", status: "idle")],
            status: "on_track"
        ),
        ProjectStreamRollup(
            projectId: "bloomfolio", name: "Bloomfolio",
            activeEpic: ActiveEpic(id: "blm-42", title: "Portfolio v2", completionPercent: 78, closedChildren: 18, totalChildren: 23),
            epicsRemaining: 1, openBeadsRemaining: 6,
            agents: [ProjectAgent(id: "tassadar", status: "blocked")],
            status: "blocked"
        ),
        ProjectStreamRollup(
            projectId: "runway", name: "Runway",
            activeEpic: ActiveEpic(id: "rwy-9", title: "Avatar bridge", completionPercent: 15, closedChildren: 2, totalChildren: 13),
            epicsRemaining: 4, openBeadsRemaining: 27,
            agents: [ProjectAgent(id: "zeratul", status: "working"), ProjectAgent(id: "artanis", status: "idle"),
                     ProjectAgent(id: "fenix", status: "working"), ProjectAgent(id: "selendis", status: "working"),
                     ProjectAgent(id: "mohandar", status: "idle"), ProjectAgent(id: "urun", status: "working")],
            status: "needs_input"
        ),
    ]

    static let totals = PortfolioTotals(
        projects: 3, agentsActive: 10, epicsRemaining: 8, openBeadsRemaining: 47,
        blocked: 1, needsInput: 1, portfolioCompletionPercent: 45
    )
}

#Preview("Mission Control — Starcraft") {
    MissionControlMapView(projects: MissionControlPreviewData.projects, totals: MissionControlPreviewData.totals)
        .frame(height: 520)
        .background(CRTTheme.ColorTheme.starcraft.background.screen)
        .crtTheme(.starcraft)
}

#Preview("Mission Control — Empty") {
    MissionControlMapView(projects: [], totals: PortfolioTotals(
        projects: 0, agentsActive: 0, epicsRemaining: 0, openBeadsRemaining: 0,
        blocked: 0, needsInput: 0, portfolioCompletionPercent: 0
    ))
    .frame(height: 520)
    .background(CRTTheme.ColorTheme.starcraft.background.screen)
    .crtTheme(.starcraft)
}
#endif
