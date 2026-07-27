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
/// adj-208.2.1). Completion percents are INTEGER 0–100 (backend `Math.round(fraction*100)`), so
/// the ring/arc/height math divides by 100. View-only in v1 — no tap-to-drill-down.
///
/// Accessibility & legibility (adj-208.3.3.x review):
/// - Status is encoded by SHAPE **and** color (not color-only): ● on-track, ◎ needs-input,
///   ▲ blocked, ○ unknown — mirrored on the agent markers. A bottom legend names the shapes.
/// - Empty portfolio renders explicit "NO ACTIVE PROJECTS" copy, not a bare hub.
/// - The map grows its content width and scrolls horizontally past ~4 projects so labels never
///   collide.
/// - Stream HEIGHT encodes distance-to-done (the proposal's signature cue).
struct MissionControlMapView: View {
    let projects: [ProjectStreamRollup]
    let totals: PortfolioTotals

    @Environment(\.crtTheme) private var theme

    // MARK: Layout constants
    private let hMargin: CGFloat = 46
    private let topMargin: CGFloat = 92      // header band + beacon + tallest node
    private let baseMargin: CGFloat = 64     // hub inset from the bottom (room for legend)
    private let nodeRadius: CGFloat = 22
    private let ringWidth: CGFloat = 5
    private let hubRadius: CGFloat = 17
    private let heightBand: CGFloat = 66     // vertical range of the distance-to-done encoding
    private let minStreamSpacing: CGFloat = 138  // below this, labels collide → grow + scroll

    var body: some View {
        GeometryReader { geo in
            let available = max(geo.size.width, 1)
            // Grow the drawable width so every stream keeps >= minStreamSpacing; scroll when it exceeds the viewport.
            let needed = CGFloat(max(projects.count - 1, 0)) * minStreamSpacing + hMargin * 2
            let contentWidth = max(available, needed)

            ScrollView(.horizontal, showsIndicators: contentWidth > available + 1) {
                mapCanvas(size: CGSize(width: contentWidth, height: geo.size.height))
                    .frame(width: contentWidth, height: geo.size.height)
            }
        }
    }

    private func mapCanvas(size: CGSize) -> some View {
        Canvas { context, canvasSize in
            let hub = MissionControlLayout.hubAnchor(size: canvasSize, margin: baseMargin)
            let backlog = MissionControlLayout.backlogAnchor(size: canvasSize, margin: baseMargin)

            drawBaseline(&context, size: canvasSize, hub: hub)

            if projects.isEmpty {
                drawEmptyState(&context, size: canvasSize, hub: hub)
            } else {
                let xs = MissionControlLayout.streamXPositions(
                    count: projects.count, width: canvasSize.width, margin: hMargin
                )
                let epics: [CGPoint] = projects.indices.map { i in
                    MissionControlLayout.epicNodePosition(
                        streamX: (i < xs.count ? xs[i] : canvasSize.width / 2),
                        completionFraction: completionFraction(projects[i]),
                        topMargin: topMargin, band: heightBand
                    )
                }
                for epic in epics { drawStream(&context, from: hub, to: epic) }
                for (i, project) in projects.enumerated() { drawProject(&context, project: project, at: epics[i]) }
                drawLegend(&context, size: canvasSize)
            }

            drawHub(&context, at: hub)
            drawBacklog(&context, at: backlog)
            drawHeader(&context, size: canvasSize)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .drawingGroup()  // rasterize the whole map once per data change — steady 60fps on scroll
    }

    private func completionFraction(_ project: ProjectStreamRollup) -> CGFloat {
        CGFloat((project.activeEpic?.completionPercent ?? 0) / 100)
    }

    // MARK: - Baseline

    private func drawBaseline(_ context: inout GraphicsContext, size: CGSize, hub: CGPoint) {
        var line = Path()
        line.move(to: CGPoint(x: hMargin, y: hub.y))
        line.addLine(to: CGPoint(x: size.width - hMargin, y: hub.y))
        context.stroke(line, with: .color(theme.dim.opacity(0.35)), lineWidth: 1)
    }

    // MARK: - Empty state (adj-208.3.3.2)

    private func drawEmptyState(_ context: inout GraphicsContext, size: CGSize, hub: CGPoint) {
        let center = CGPoint(x: size.width / 2, y: (topMargin + hub.y) / 2)
        let title = Text("NO ACTIVE PROJECTS")
            .font(.system(size: 13, weight: .bold, design: .monospaced))
            .foregroundColor(theme.textSecondary)
        context.draw(title, at: center, anchor: .center)
        let sub = Text("No projects are reporting activity yet.")
            .font(.system(size: 10, weight: .regular, design: .monospaced))
            .foregroundColor(theme.dim)
        context.draw(sub, at: CGPoint(x: center.x, y: center.y + 18), anchor: .center)
    }

    // MARK: - Stream

    private func drawStream(_ context: inout GraphicsContext, from hub: CGPoint, to epic: CGPoint) {
        var path = Path()
        path.move(to: hub)
        let dy = (epic.y - hub.y) * 0.5  // smooth S-curve rising from the base hub to the epic node
        path.addCurve(
            to: epic,
            control1: CGPoint(x: hub.x, y: hub.y + dy),
            control2: CGPoint(x: epic.x, y: epic.y - dy)
        )
        context.stroke(
            path,
            with: .linearGradient(
                Gradient(colors: [CRTTheme.Brand.violet.opacity(0.85), CRTTheme.Brand.cyan]),
                startPoint: hub, endPoint: epic
            ),
            style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
        )
    }

    // MARK: - Project cluster (node + ring + beacon + name + badge + agents)

    private func drawProject(_ context: inout GraphicsContext, project: ProjectStreamRollup, at epic: CGPoint) {
        let percent100 = project.activeEpic?.completionPercent ?? 0
        let fraction = CGFloat(percent100 / 100)

        // Completion ring — dim track + bright progress arc.
        let ringRect = CGRect(x: epic.x - nodeRadius, y: epic.y - nodeRadius, width: nodeRadius * 2, height: nodeRadius * 2)
        context.stroke(Path(ellipseIn: ringRect), with: .color(theme.dim.opacity(0.3)), lineWidth: ringWidth)

        let startAngle: CGFloat = -.pi / 2
        let endAngle = MissionControlLayout.completionArcEndAngle(percent: fraction, startAngle: startAngle)
        var arc = Path()
        arc.addArc(center: epic, radius: nodeRadius,
                   startAngle: Angle(radians: Double(startAngle)),
                   endAngle: Angle(radians: Double(endAngle)), clockwise: false)
        context.stroke(arc, with: .color(CRTTheme.Brand.cyan), style: StrokeStyle(lineWidth: ringWidth, lineCap: .round))

        // Node fill + completion % label.
        context.fill(Path(ellipseIn: ringRect.insetBy(dx: ringWidth, dy: ringWidth)), with: .color(theme.background.elevated))
        let pctText = Text("\(Int(percent100.rounded()))%")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.cyanText)
        context.draw(pctText, at: epic, anchor: .center)

        // Status beacon above the node — SHAPE + color (not color-only).
        let beaconKey = MissionControlLayout.beaconKey(forStatus: project.status)
        drawBeacon(&context, at: CGPoint(x: epic.x, y: epic.y - nodeRadius - 12), key: beaconKey)

        // Project name.
        let name = Text(project.name.uppercased())
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundColor(theme.textPrimary)
        context.draw(name, at: CGPoint(x: epic.x, y: epic.y + nodeRadius + 13), anchor: .center)

        // Remaining-work badge — scaled by backlog weight. "N epics · M open beads" (adj-208.3.3.6).
        let remaining = project.epicsRemaining + project.openBeadsRemaining
        let scale = MissionControlLayout.remainingBadgeScale(remaining: remaining)
        let badge = Text("\(project.epicsRemaining) EPICS · \(project.openBeadsRemaining) OPEN BEADS")
            .font(.system(size: 9 * scale, weight: .medium, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.violetText)
        context.draw(badge, at: CGPoint(x: epic.x, y: epic.y + nodeRadius + 29), anchor: .center)

        // Agent markers — shape+color coded (adj-208.3.3.1), cap at 5 then "+N".
        drawAgents(&context, agents: project.agents, centerX: epic.x, y: epic.y + nodeRadius + 46)
    }

    // MARK: - Status beacon shapes (adj-208.3.3.1)

    /// Redundant SHAPE + color encoding so status is legible without relying on hue alone.
    private func drawBeacon(_ context: inout GraphicsContext, at c: CGPoint, key: MissionControlLayout.BeaconKey) {
        let color = beaconColor(key)
        let r: CGFloat = 6
        context.fill(Path(ellipseIn: CGRect(x: c.x - r - 3, y: c.y - r - 3, width: (r + 3) * 2, height: (r + 3) * 2)),
                     with: .color(color.opacity(0.22)))  // halo
        switch key {
        case .green:  // ● solid disc
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color))
        case .amber:  // ◎ ring + center dot
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 2)
            context.fill(Path(ellipseIn: CGRect(x: c.x - 2, y: c.y - 2, width: 4, height: 4)), with: .color(color))
        case .red:    // ▲ filled triangle (alert)
            context.fill(trianglePath(center: c, radius: r + 1), with: .color(color))
        case .neutral:  // ○ hollow thin ring
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 1.5)
        }
    }

    private func trianglePath(center c: CGPoint, radius r: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: c.x, y: c.y - r))
        p.addLine(to: CGPoint(x: c.x + r * 0.9, y: c.y + r * 0.75))
        p.addLine(to: CGPoint(x: c.x - r * 0.9, y: c.y + r * 0.75))
        p.closeSubpath()
        return p
    }

    private func drawAgents(_ context: inout GraphicsContext, agents: [ProjectAgent], centerX: CGFloat, y: CGFloat) {
        guard !agents.isEmpty else { return }
        let maxDots = 5
        let shown = min(agents.count, maxDots)
        let spacing: CGFloat = 13
        let totalWidth = CGFloat(shown - 1) * spacing
        var x = centerX - totalWidth / 2
        for i in 0..<shown {
            drawAgentMarker(&context, at: CGPoint(x: x, y: y), status: agents[i].status)
            x += spacing
        }
        if agents.count > maxDots {
            let more = Text("+\(agents.count - maxDots)")
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(theme.dim)
            context.draw(more, at: CGPoint(x: x + 3, y: y), anchor: .leading)
        }
    }

    /// Agent status by SHAPE + color: ● working, ○ idle, ▲ blocked, ⊘ offline.
    private func drawAgentMarker(_ context: inout GraphicsContext, at c: CGPoint, status: String) {
        let color = agentColor(status)
        let r: CGFloat = 4
        switch status.lowercased() {
        case "working":
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color))
        case "blocked":
            context.fill(trianglePath(center: c, radius: r + 0.5), with: .color(color))
        case "idle":
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 1.5)
        default:  // offline — hollow ring + slash
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 1)
            var slash = Path(); slash.move(to: CGPoint(x: c.x - r, y: c.y + r)); slash.addLine(to: CGPoint(x: c.x + r, y: c.y - r))
            context.stroke(slash, with: .color(color), lineWidth: 1)
        }
    }

    // MARK: - Legend (adj-208.3.3.1 — names the shapes so they aren't color-only)

    private func drawLegend(_ context: inout GraphicsContext, size: CGSize) {
        let y = size.height - baseMargin + 30
        var x = hMargin
        for (key, label) in [(MissionControlLayout.BeaconKey.green, "ON TRACK"),
                             (.amber, "NEEDS INPUT"),
                             (.red, "BLOCKED")] {
            drawBeacon(&context, at: CGPoint(x: x + 5, y: y), key: key)
            let text = Text(label)
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .foregroundColor(theme.dim)
            context.draw(text, at: CGPoint(x: x + 14, y: y), anchor: .leading)
            x += 14 + CGFloat(label.count) * 5.4 + 16
        }
    }

    // MARK: - Hub

    private func drawHub(_ context: inout GraphicsContext, at hub: CGPoint) {
        let rect = CGRect(x: hub.x - hubRadius, y: hub.y - hubRadius, width: hubRadius * 2, height: hubRadius * 2)
        context.fill(Path(ellipseIn: rect.insetBy(dx: -6, dy: -6)), with: .color(CRTTheme.Brand.violet.opacity(0.18)))  // halo
        context.fill(Path(ellipseIn: rect), with: .color(theme.background.elevated))
        context.stroke(Path(ellipseIn: rect), with: .color(CRTTheme.Brand.violet), lineWidth: 2.5)
        context.draw(Text("ADJ").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(CRTTheme.Brand.violetText),
                     at: hub, anchor: .center)
        context.draw(Text("COORDINATOR").font(.system(size: 8, weight: .medium, design: .monospaced)).foregroundColor(theme.dim),
                     at: CGPoint(x: hub.x, y: hub.y + hubRadius + 11), anchor: .center)
    }

    // MARK: - Backlog reservoir

    private func drawBacklog(_ context: inout GraphicsContext, at backlog: CGPoint) {
        let queued = max(0, totals.epicsRemaining)
        let bars = min(queued, 3)
        for i in 0..<max(bars, 1) {
            let w: CGFloat = 26 - CGFloat(i) * 4
            let rect = CGRect(x: backlog.x - w / 2, y: backlog.y - 14 - CGFloat(i) * 6, width: w, height: 4)
            let filled = i < bars
            context.fill(Path(roundedRect: rect, cornerRadius: 2),
                         with: .color(filled ? CRTTheme.Brand.cyan.opacity(0.7) : theme.dim.opacity(0.3)))
        }
        context.draw(Text(queued > 0 ? "QUEUE +\(queued)" : "QUEUE 0").font(.system(size: 8, weight: .medium, design: .monospaced)).foregroundColor(theme.dim),
                     at: CGPoint(x: backlog.x, y: backlog.y + 6), anchor: .center)
    }

    // MARK: - Portfolio header

    private func drawHeader(_ context: inout GraphicsContext, size: CGSize) {
        context.draw(Text("MISSION CONTROL").font(.system(size: 13, weight: .bold, design: .monospaced)).foregroundColor(CRTTheme.Brand.cyanText),
                     at: CGPoint(x: hMargin, y: 22), anchor: .leading)

        let pct = Int(totals.portfolioCompletionPercent.rounded())  // already 0–100
        let stats = Text("\(totals.projects) PROJ · \(pct)% · \(totals.agentsActive) AGENTS · \(totals.epicsRemaining) EPICS · \(totals.openBeadsRemaining) OPEN BEADS")
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .foregroundColor(theme.textSecondary)
        context.draw(stats, at: CGPoint(x: hMargin, y: 40), anchor: .leading)

        // Attention chips: blocked / needs-input, only when non-zero. Outline-only (no fill) so the
        // small bold status-color text keeps AA contrast on the dark screen (adj-208.3.3.1).
        var chipX = size.width - hMargin
        if totals.blocked > 0 {
            chipX = drawChip(&context, text: "\(totals.blocked) BLOCKED", color: CRTTheme.State.error, rightX: chipX, y: 30)
        }
        if totals.needsInput > 0 {
            _ = drawChip(&context, text: "\(totals.needsInput) NEEDS INPUT", color: CRTTheme.State.warning, rightX: chipX, y: 30)
        }
    }

    /// Draws a right-anchored, outline-only status chip; returns the x where the next chip (to its left) ends.
    private func drawChip(_ context: inout GraphicsContext, text: String, color: Color, rightX: CGFloat, y: CGFloat) -> CGFloat {
        let label = Text(text).font(.system(size: 9, weight: .bold, design: .monospaced)).foregroundColor(color)
        let resolved = context.resolve(label)
        let sz = resolved.measure(in: CGSize(width: 400, height: 40))
        let padding: CGFloat = 8
        let width = sz.width + padding * 2
        let rect = CGRect(x: rightX - width, y: y - 9, width: width, height: 18)
        // No fill — text sits on the dark screen for AA. A subtle border carries the chip affordance.
        context.stroke(Path(roundedRect: rect, cornerRadius: 4), with: .color(color.opacity(0.7)), lineWidth: 1)
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
        if projects.isEmpty {
            return "Mission Control. No active projects are reporting activity."
        }
        let pct = Int(totals.portfolioCompletionPercent.rounded())
        var parts = ["Mission Control. \(totals.projects) projects, \(pct) percent complete, \(totals.agentsActive) active agents, \(totals.epicsRemaining) epics and \(totals.openBeadsRemaining) open beads remaining."]
        if totals.blocked > 0 { parts.append("\(totals.blocked) blocked.") }
        if totals.needsInput > 0 { parts.append("\(totals.needsInput) need input.") }
        for p in projects {
            let c = Int((p.activeEpic?.completionPercent ?? 0).rounded())
            parts.append("\(p.name): \(p.status.replacingOccurrences(of: "_", with: " ")), \(c) percent, \(p.epicsRemaining) epics and \(p.openBeadsRemaining) open beads remaining, \(p.agents.count) agents.")
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

    /// Six projects to exercise the horizontal-scroll / anti-collision path (adj-208.3.3.3).
    static let manyProjects: [ProjectStreamRollup] = projects + [
        ProjectStreamRollup(projectId: "p4", name: "Sanctuary", activeEpic: ActiveEpic(id: "s-1", title: "Ward", completionPercent: 90, closedChildren: 9, totalChildren: 10), epicsRemaining: 0, openBeadsRemaining: 2, agents: [ProjectAgent(id: "vorazun", status: "working")], status: "on_track"),
        ProjectStreamRollup(projectId: "p5", name: "Aiur", activeEpic: ActiveEpic(id: "a-1", title: "Rebuild", completionPercent: 33, closedChildren: 4, totalChildren: 12), epicsRemaining: 2, openBeadsRemaining: 18, agents: [ProjectAgent(id: "karax", status: "idle")], status: "needs_input"),
        ProjectStreamRollup(projectId: "p6", name: "Shakuras", activeEpic: nil, epicsRemaining: 5, openBeadsRemaining: 31, agents: [], status: "blocked"),
    ]
}

#Preview("Mission Control — 3 projects") {
    MissionControlMapView(projects: MissionControlPreviewData.projects, totals: MissionControlPreviewData.totals)
        .frame(height: 520)
        .background(CRTTheme.ColorTheme.starcraft.background.screen)
        .crtTheme(.starcraft)
}

#Preview("Mission Control — 6 projects (scroll)") {
    MissionControlMapView(projects: MissionControlPreviewData.manyProjects, totals: MissionControlPreviewData.totals)
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
