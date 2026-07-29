import SwiftUI
import AdjutantKit

// MARK: - MissionControlMapView

/// Natively-drawn (SwiftUI `Canvas`/`Path`) portfolio coordination map
/// (adj-208.3.3, extended for per-feature agentic intensity in adj-209.4.2).
///
/// A single Canvas draws every element in one GPU-backed pass (no per-node SwiftUI views → 60fps):
/// the coordinator hub at the base, one stream per project rising to its active-epic node with a
/// completion ring, the project's in-progress FEATURES as distinct waypoint nodes along the stream
/// (each with its own completion ring, status beacon, and UNCAPPED agent count), a status beacon,
/// a queued/backlog reservoir, and a portfolio header line. All geometry comes from the pure,
/// unit-tested `MissionControlLayout`; all color from the `CRTTheme.Brand` tokens (adj-208.3.1).
///
/// **Per-feature agentic intensity (adj-209.4.2):** each project carries a composite
/// `activityLevel` (0…1, backend-computed from agents + progress cadence + in-progress beads).
/// `MissionControlLayout.intensity(activityLevel:)` maps it to a monotonic
/// `(streamThickness, glowRadius, flowSpeed)`. A busier stream is THICKER, BRIGHTER, GLOWS more,
/// and its flow dashes move FASTER — so "busy reads hotter" at a glance. Thickness/brightness/glow
/// are visible in a static frame (so a screenshot still tells the story); flow speed is the live
/// extra via `TimelineView(.animation)`.
///
/// Consumes the real `AdjutantKit` rollup model (`ProjectStreamRollup`/`FeatureRollup`/
/// `PortfolioTotals`). Completion percents are INTEGER 0–100. View-only — no tap-to-drill-down.
///
/// Accessibility & legibility:
/// - Status is encoded by SHAPE **and** color (● on-track, ◎ needs-input, ▲ blocked, ○ unknown).
/// - Agent counts are shown as exact NUMBERS (uncapped) — no "+N" truncation that hides real load.
/// - Empty portfolio renders explicit "NO ACTIVE PROJECTS" copy.
/// - The map grows its content width and scrolls horizontally past ~4 projects so labels never collide.
struct MissionControlMapView: View {
    let projects: [ProjectStreamRollup]
    let totals: PortfolioTotals

    // Only the layout constants the SCROLL container needs to size its content.
    private let hMargin: CGFloat = 46
    private let minStreamSpacing: CGFloat = 138  // below this, labels collide → grow + scroll

    var body: some View {
        GeometryReader { geo in
            let available = max(geo.size.width, 1)
            // Grow the drawable width so every stream keeps >= minStreamSpacing; scroll when it exceeds the viewport.
            let needed = CGFloat(max(projects.count - 1, 0)) * minStreamSpacing + hMargin * 2
            let contentWidth = max(available, needed)

            ScrollView(.horizontal, showsIndicators: contentWidth > available + 1) {
                MissionControlCanvasView(
                    projects: projects, totals: totals,
                    size: CGSize(width: contentWidth, height: geo.size.height)
                )
            }
        }
    }
}

/// The drawn Mission Control map at an EXPLICIT size, with NO scroll container.
///
/// Separating the drawing from `MissionControlMapView`'s `ScrollView` keeps the layout/scroll
/// concern and the rendering concern in different types (cleaner + independently testable), and
/// gives an offscreen `ImageRenderer` a scroll-free entry point — `ScrollView` renders BLANK under
/// `ImageRenderer`, which the adj-209.4.3 PNG validation harness relies on.
struct MissionControlCanvasView: View {
    let projects: [ProjectStreamRollup]
    let totals: PortfolioTotals
    let size: CGSize

    @Environment(\.crtTheme) private var theme

    // MARK: Layout constants
    private let hMargin: CGFloat = 46
    private let topMargin: CGFloat = 92      // header band + beacon + tallest node
    private let baseMargin: CGFloat = 72     // hub inset from the bottom (room for caption + legend)
    private let nodeRadius: CGFloat = 22
    private let ringWidth: CGFloat = 5
    private let featureRadius: CGFloat = 12   // smaller than the headline epic node
    private let featureRingWidth: CGFloat = 3
    private let featureSpread: CGFloat = 46    // horizontal fan of feature tributaries
    private let hubRadius: CGFloat = 17
    private let heightBand: CGFloat = 66     // vertical range of the distance-to-done encoding

    /// Base flow speed (dash phase points/sec at flowSpeed == 1). Scaled per stream by intensity.
    private let baseFlowRate: CGFloat = 26

    var body: some View {
        // TimelineView drives the animated flow; thickness/brightness/glow are STATIC so a single
        // captured frame still shows the intensity difference (used by the PNG validator).
        // Qualify SwiftUI.TimelineView — the app defines its own `TimelineView`
        // (Features/Timeline/TimelineView.swift) which shadows SwiftUI's here.
        SwiftUI.TimelineView(SwiftUI.AnimationTimelineSchedule(minimumInterval: 1.0 / 30.0, paused: false)) { timeline in
            let phase = CGFloat(timeline.date.timeIntervalSinceReferenceDate)
            mapCanvas(flowPhase: phase)
                .frame(width: size.width, height: size.height)
        }
    }

    private func mapCanvas(flowPhase: CGFloat) -> some View {
        Canvas { context, canvasSize in
            let hub = MissionControlLayout.hubAnchor(size: canvasSize, margin: baseMargin)
            let backlog = MissionControlLayout.backlogAnchor(size: canvasSize, margin: baseMargin)
            let bottom = MissionControlLayout.bottomBand(height: canvasSize.height, hubY: hub.y, hubRadius: hubRadius)

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
                // Streams first (under the nodes), each with its own intensity.
                for (i, project) in projects.enumerated() {
                    drawStream(&context, from: hub, to: epics[i],
                               intensity: intensity(project), flowPhase: flowPhase)
                }
                // Feature tributaries + nodes, then the headline project cluster on top.
                for (i, project) in projects.enumerated() {
                    let streamX = (i < xs.count ? xs[i] : canvasSize.width / 2)
                    drawFeatures(&context, project: project, streamX: streamX,
                                 epic: epics[i], hub: hub, drawWidth: canvasSize.width)
                    drawProject(&context, project: project, at: epics[i], drawWidth: canvasSize.width)
                }
                drawLegend(&context, legendY: bottom.legendY)
            }

            drawHub(&context, at: hub, captionY: bottom.captionY)
            drawBacklog(&context, at: backlog)
            drawHeader(&context, size: canvasSize)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
    }

    private func completionFraction(_ project: ProjectStreamRollup) -> CGFloat {
        CGFloat((project.activeEpic?.completionPercent ?? 0) / 100)
    }

    private func intensity(_ project: ProjectStreamRollup) -> MissionControlLayout.Intensity {
        MissionControlLayout.intensity(activityLevel: CGFloat(project.activityLevel))
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

    // MARK: - Stream (intensity: thickness + brightness + animated flow)

    private func drawStream(_ context: inout GraphicsContext, from hub: CGPoint, to epic: CGPoint,
                            intensity: MissionControlLayout.Intensity, flowPhase: CGFloat) {
        var path = Path()
        path.move(to: hub)
        let dy = (epic.y - hub.y) * 0.5  // smooth S-curve rising from the base hub to the epic node
        path.addCurve(
            to: epic,
            control1: CGPoint(x: hub.x, y: hub.y + dy),
            control2: CGPoint(x: epic.x, y: epic.y - dy)
        )

        // Brightness rises with heat so a busy stream reads brighter, not just thicker.
        let heat = brightness(for: intensity)
        let gradient = Gradient(colors: [
            CRTTheme.Brand.violet.opacity(0.35 + 0.55 * heat),
            CRTTheme.Brand.cyan.opacity(0.55 + 0.45 * heat)
        ])

        // Soft under-glow whose radius scales with activity (0 at idle → visible bloom when hot).
        if intensity.glowRadius > 0.5 {
            var glowCtx = context
            glowCtx.addFilter(.blur(radius: intensity.glowRadius * 0.6))
            glowCtx.stroke(path, with: .color(CRTTheme.Brand.cyan.opacity(0.20 + 0.30 * heat)),
                           style: StrokeStyle(lineWidth: intensity.streamThickness + 2, lineCap: .round))
        }

        // Base stream.
        context.stroke(
            path,
            with: .linearGradient(gradient, startPoint: hub, endPoint: epic),
            style: StrokeStyle(lineWidth: intensity.streamThickness, lineCap: .round)
        )

        // Animated flow: bright dashes drifting hub → epic at a speed that scales with activity.
        let dashPhase = -flowPhase * baseFlowRate * intensity.flowSpeed
        context.stroke(
            path,
            with: .color(CRTTheme.Brand.cyanText.opacity(0.35 + 0.5 * heat)),
            style: StrokeStyle(lineWidth: max(1.5, intensity.streamThickness * 0.4),
                               lineCap: .round, dash: [3, 11], dashPhase: dashPhase)
        )
    }

    /// Normalized "heat" 0…1 recovered from the intensity's thickness (its canonical scale),
    /// used to drive brightness/opacity consistently across stream and nodes.
    private func brightness(for intensity: MissionControlLayout.Intensity) -> CGFloat {
        let cold = MissionControlLayout.intensity(activityLevel: 0).streamThickness
        let hot = MissionControlLayout.intensity(activityLevel: 1).streamThickness
        guard hot > cold else { return 1 }
        return min(max((intensity.streamThickness - cold) / (hot - cold), 0), 1)
    }

    // MARK: - Feature tributary nodes (adj-209.4.2)

    /// Draws each in-progress FEATURE as a distinct waypoint node fanned along the stream between
    /// the hub and the epic node — a small completion ring + status beacon + exact agent count,
    /// linked to the stream centerline by a thin tributary connector.
    private func drawFeatures(_ context: inout GraphicsContext, project: ProjectStreamRollup,
                              streamX: CGFloat, epic: CGPoint, hub: CGPoint, drawWidth: CGFloat) {
        guard !project.features.isEmpty else { return }
        // Reserve a little clearance above the epic node and above the hub so nodes never collide with them.
        let bandTop = epic.y + nodeRadius + featureRadius + 6
        let bandBottom = hub.y - hubRadius - featureRadius - 8
        guard bandBottom > bandTop else { return }  // stream too short for tributaries this frame

        let pts = MissionControlLayout.featureNodePositions(
            count: project.features.count,
            streamX: streamX, epicY: bandTop, hubY: bandBottom,
            spread: featureSpread,
            minX: hMargin + featureRadius, maxX: drawWidth - hMargin - featureRadius
        )

        for (i, feature) in project.features.enumerated() where i < pts.count {
            let p = pts[i]
            let fi = MissionControlLayout.intensity(activityLevel: CGFloat(feature.activityLevel))
            let heat = brightness(for: fi)

            // Tributary connector from the stream centerline to the feature node.
            var link = Path()
            link.move(to: CGPoint(x: streamX, y: p.y))
            link.addLine(to: p)
            context.stroke(link, with: .color(theme.dim.opacity(0.35 + 0.25 * heat)),
                           style: StrokeStyle(lineWidth: 1, dash: [2, 3]))

            // Activity glow around the node (scales with the feature's own heat).
            if fi.glowRadius > 0.5 {
                let gr = featureRadius + fi.glowRadius * 0.7
                context.fill(
                    Path(ellipseIn: CGRect(x: p.x - gr, y: p.y - gr, width: gr * 2, height: gr * 2)),
                    with: .color(CRTTheme.Brand.cyan.opacity(0.10 + 0.18 * heat))
                )
            }

            // Completion ring — track + progress arc, brightened by heat.
            let r = featureRadius
            let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            context.stroke(Path(ellipseIn: rect), with: .color(theme.dim.opacity(0.30)), lineWidth: featureRingWidth)
            let fraction = CGFloat(feature.completionPercent / 100)
            let start: CGFloat = -.pi / 2
            let end = MissionControlLayout.completionArcEndAngle(percent: fraction, startAngle: start)
            var arc = Path()
            arc.addArc(center: p, radius: r, startAngle: Angle(radians: Double(start)),
                       endAngle: Angle(radians: Double(end)), clockwise: false)
            context.stroke(arc, with: .color(CRTTheme.Brand.cyan.opacity(0.6 + 0.4 * heat)),
                           style: StrokeStyle(lineWidth: featureRingWidth, lineCap: .round))

            // Node fill.
            context.fill(Path(ellipseIn: rect.insetBy(dx: featureRingWidth, dy: featureRingWidth)),
                         with: .color(theme.background.elevated))

            // Status beacon (SHAPE + color) at the node's top-left shoulder.
            let key = MissionControlLayout.beaconKey(forStatus: feature.status)
            drawBeacon(&context, at: CGPoint(x: p.x - r + 1, y: p.y - r + 1), key: key, scale: 0.62)

            // Exact, UNCAPPED agent count centered in the node (an ⓐ glyph + number).
            let count = feature.agents.count
            let label = Text("\(count)")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundColor(count > 0 ? CRTTheme.Brand.cyanText : theme.dim)
            context.draw(label, at: p, anchor: .center)
        }
    }

    // MARK: - Project cluster (headline epic node + ring + beacon + name + badge + agents)

    private func drawProject(_ context: inout GraphicsContext, project: ProjectStreamRollup, at epic: CGPoint, drawWidth: CGFloat) {
        let percent100 = project.activeEpic?.completionPercent ?? 0
        let fraction = CGFloat(percent100 / 100)
        let intens = intensity(project)
        let heat = brightness(for: intens)

        // Headline-node activity glow (scales with the project's composite heat).
        if intens.glowRadius > 0.5 {
            let gr = nodeRadius + intens.glowRadius
            context.fill(
                Path(ellipseIn: CGRect(x: epic.x - gr, y: epic.y - gr, width: gr * 2, height: gr * 2)),
                with: .color(CRTTheme.Brand.cyan.opacity(0.08 + 0.16 * heat))
            )
        }

        // Completion ring — dim track + bright progress arc.
        let ringRect = CGRect(x: epic.x - nodeRadius, y: epic.y - nodeRadius, width: nodeRadius * 2, height: nodeRadius * 2)
        context.stroke(Path(ellipseIn: ringRect), with: .color(theme.dim.opacity(0.3)), lineWidth: ringWidth)

        let startAngle: CGFloat = -.pi / 2
        let endAngle = MissionControlLayout.completionArcEndAngle(percent: fraction, startAngle: startAngle)
        var arc = Path()
        arc.addArc(center: epic, radius: nodeRadius,
                   startAngle: Angle(radians: Double(startAngle)),
                   endAngle: Angle(radians: Double(endAngle)), clockwise: false)
        context.stroke(arc, with: .color(CRTTheme.Brand.cyan.opacity(0.7 + 0.3 * heat)), style: StrokeStyle(lineWidth: ringWidth, lineCap: .round))

        // Node fill + completion % label.
        context.fill(Path(ellipseIn: ringRect.insetBy(dx: ringWidth, dy: ringWidth)), with: .color(theme.background.elevated))
        let pctText = Text("\(Int(percent100.rounded()))%")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(CRTTheme.Brand.cyanText)
        context.draw(pctText, at: epic, anchor: .center)

        // Status beacon above the node — SHAPE + color (not color-only).
        let beaconKey = MissionControlLayout.beaconKey(forStatus: project.status)
        drawBeacon(&context, at: CGPoint(x: epic.x, y: epic.y - nodeRadius - 12), key: beaconKey)

        // Label cluster: project name + two-line remaining-work badge + exact agent count. Kept narrow
        // (two lines) and horizontally CLAMPED as a group so the outermost projects' labels never clip.
        let name = Text(project.name.uppercased())
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundColor(theme.textPrimary)

        let remaining = project.epicsRemaining + project.openBeadsRemaining
        let badgeScale = MissionControlLayout.remainingBadgeScale(remaining: remaining, maxScale: 1.15)
        let badgeFont = Font.system(size: 8.5 * badgeScale, weight: .medium, design: .monospaced)
        let epicsLine = Text("\(project.epicsRemaining) EPICS").font(badgeFont).foregroundColor(CRTTheme.Brand.violetText)
        let beadsLine = Text("\(project.openBeadsRemaining) OPEN BEADS").font(badgeFont).foregroundColor(CRTTheme.Brand.violetText)

        let nameResolved = context.resolve(name)
        let beadsResolved = context.resolve(beadsLine)
        let clusterWidth = max(
            nameResolved.measure(in: CGSize(width: drawWidth, height: 40)).width,
            beadsResolved.measure(in: CGSize(width: drawWidth, height: 40)).width
        )
        let labelX = MissionControlLayout.clampedCenterX(
            desiredCenterX: epic.x, labelWidth: clusterWidth, drawWidth: drawWidth, margin: hMargin
        )

        context.draw(nameResolved, at: CGPoint(x: labelX, y: epic.y + nodeRadius + 13), anchor: .center)
        context.draw(context.resolve(epicsLine), at: CGPoint(x: labelX, y: epic.y + nodeRadius + 27), anchor: .center)
        context.draw(beadsResolved, at: CGPoint(x: labelX, y: epic.y + nodeRadius + 39), anchor: .center)

        // Exact, UNCAPPED project agent total (no 5-dot cap). A representative status dot + the true number.
        drawAgentTotal(&context, agents: project.agents, agentCount: project.agentCount,
                       centerX: labelX, y: epic.y + nodeRadius + 54)
    }

    // MARK: - Status beacon shapes (adj-208.3.3.1)

    /// Redundant SHAPE + color encoding so status is legible without relying on hue alone.
    private func drawBeacon(_ context: inout GraphicsContext, at c: CGPoint, key: MissionControlLayout.BeaconKey, scale: CGFloat = 1) {
        let color = beaconColor(key)
        let r: CGFloat = 6 * scale
        context.fill(Path(ellipseIn: CGRect(x: c.x - r - 3 * scale, y: c.y - r - 3 * scale, width: (r + 3 * scale) * 2, height: (r + 3 * scale) * 2)),
                     with: .color(color.opacity(0.22)))  // halo
        switch key {
        case .green:  // ● solid disc
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color))
        case .amber:  // ◎ ring + center dot
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 2 * scale)
            context.fill(Path(ellipseIn: CGRect(x: c.x - 2 * scale, y: c.y - 2 * scale, width: 4 * scale, height: 4 * scale)), with: .color(color))
        case .red:    // ▲ filled triangle (alert)
            context.fill(trianglePath(center: c, radius: r + 1 * scale), with: .color(color))
        case .neutral:  // ○ hollow thin ring
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 1.5 * scale)
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

    /// Exact, UNCAPPED agent readout for a project: a representative status dot + the true count and
    /// the word AGENTS. Replaces the old 5-dot "+N" cap so real load is never hidden (adj-209.4.2).
    private func drawAgentTotal(_ context: inout GraphicsContext, agents: [ProjectAgent], agentCount: Int, centerX: CGFloat, y: CGFloat) {
        let count = max(agentCount, agents.count)
        guard count > 0 else { return }
        // Pick the most severe status present so the dot colour reflects the worst-case agent.
        let dotColor = agentColor(dominantStatus(agents))
        let text = Text("\(count) AGENT\(count == 1 ? "" : "S")")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundColor(theme.textSecondary)
        let resolved = context.resolve(text)
        let sz = resolved.measure(in: CGSize(width: 200, height: 20))
        let dotR: CGFloat = 3.5
        let gap: CGFloat = 6
        let totalW = dotR * 2 + gap + sz.width
        let startX = centerX - totalW / 2
        context.fill(Path(ellipseIn: CGRect(x: startX, y: y - dotR, width: dotR * 2, height: dotR * 2)), with: .color(dotColor))
        context.draw(resolved, at: CGPoint(x: startX + dotR * 2 + gap, y: y), anchor: .leading)
    }

    /// The most severe status among a project's agents (blocked > working > idle > other),
    /// so a single summary dot flags trouble rather than averaging it away.
    private func dominantStatus(_ agents: [ProjectAgent]) -> String {
        let order = ["blocked", "working", "idle"]
        for s in order where agents.contains(where: { $0.status.lowercased() == s }) { return s }
        return agents.first?.status ?? "offline"
    }

    // MARK: - Legend (adj-208.3.3.1 — names the shapes so they aren't color-only)

    private func drawLegend(_ context: inout GraphicsContext, legendY y: CGFloat) {
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

    private func drawHub(_ context: inout GraphicsContext, at hub: CGPoint, captionY: CGFloat) {
        let rect = CGRect(x: hub.x - hubRadius, y: hub.y - hubRadius, width: hubRadius * 2, height: hubRadius * 2)
        context.fill(Path(ellipseIn: rect.insetBy(dx: -6, dy: -6)), with: .color(CRTTheme.Brand.violet.opacity(0.18)))  // halo
        context.fill(Path(ellipseIn: rect), with: .color(theme.background.elevated))
        context.stroke(Path(ellipseIn: rect), with: .color(CRTTheme.Brand.violet), lineWidth: 2.5)
        context.draw(Text("ADJ").font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundColor(CRTTheme.Brand.violetText),
                     at: hub, anchor: .center)
        context.draw(Text("COORDINATOR").font(.system(size: 8, weight: .medium, design: .monospaced)).foregroundColor(theme.dim),
                     at: CGPoint(x: hub.x, y: captionY), anchor: .center)
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

        // Attention chips: blocked / needs-input, only when non-zero. Outline-only (no fill).
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
            let activity = Int((p.activityLevel * 100).rounded())
            var line = "\(p.name): \(p.status.replacingOccurrences(of: "_", with: " ")), \(c) percent, activity \(activity) percent, \(p.epicsRemaining) epics and \(p.openBeadsRemaining) open beads remaining, \(p.agentCount) agents."
            if !p.features.isEmpty {
                line += " \(p.features.count) active features."
            }
            parts.append(line)
        }
        return parts.joined(separator: " ")
    }
}

// MARK: - Preview

#if DEBUG
/// Sample portfolio for previews (real `AdjutantKit` rollup types). Percents are 0–100; activityLevel 0–1.
private enum MissionControlPreviewData {
    static func agents(_ statuses: [String]) -> [ProjectAgent] {
        statuses.enumerated().map { ProjectAgent(id: "a\($0.offset)", status: $0.element) }
    }

    /// LOW activity portfolio — everything idle/cool (streams thin, dim, barely flowing).
    static let low: [ProjectStreamRollup] = [
        ProjectStreamRollup(
            projectId: "adjutant", name: "Adjutant",
            activeEpic: ActiveEpic(id: "adj-209", title: "Mission Control", completionPercent: 30, closedChildren: 3, totalChildren: 10),
            epicsRemaining: 2, openBeadsRemaining: 9, agents: agents(["idle"]),
            status: "on_track",
            features: [
                FeatureRollup(id: "f1", title: "Selector", completionPercent: 20, closedChildren: 1, totalChildren: 5, agents: agents(["idle"]), activityLevel: 0.05, status: "on_track"),
                FeatureRollup(id: "f2", title: "Map", completionPercent: 40, closedChildren: 2, totalChildren: 5, agents: [], activityLevel: 0.0, status: "on_track"),
            ],
            activityLevel: 0.06, agentCount: 1
        ),
        ProjectStreamRollup(
            projectId: "bloomfolio", name: "Bloomfolio",
            activeEpic: ActiveEpic(id: "blm-42", title: "Portfolio v2", completionPercent: 55, closedChildren: 11, totalChildren: 20),
            epicsRemaining: 1, openBeadsRemaining: 4, agents: [],
            status: "on_track",
            features: [
                FeatureRollup(id: "b1", title: "Cards", completionPercent: 60, closedChildren: 3, totalChildren: 5, agents: [], activityLevel: 0.0, status: "on_track"),
            ],
            activityLevel: 0.02, agentCount: 0
        ),
    ]

    /// HIGH activity portfolio — same shape, but hot: many agents, high activityLevel.
    static let high: [ProjectStreamRollup] = [
        ProjectStreamRollup(
            projectId: "adjutant", name: "Adjutant",
            activeEpic: ActiveEpic(id: "adj-209", title: "Mission Control", completionPercent: 30, closedChildren: 3, totalChildren: 10),
            epicsRemaining: 2, openBeadsRemaining: 9,
            agents: agents(["working", "working", "working", "working", "working", "working", "working"]),
            status: "on_track",
            features: [
                FeatureRollup(id: "f1", title: "Selector", completionPercent: 20, closedChildren: 1, totalChildren: 5, agents: agents(["working", "working", "working"]), activityLevel: 0.95, status: "on_track"),
                FeatureRollup(id: "f2", title: "Map", completionPercent: 40, closedChildren: 2, totalChildren: 5, agents: agents(["working", "working", "working", "working"]), activityLevel: 0.88, status: "on_track"),
            ],
            activityLevel: 0.96, agentCount: 7
        ),
        ProjectStreamRollup(
            projectId: "bloomfolio", name: "Bloomfolio",
            activeEpic: ActiveEpic(id: "blm-42", title: "Portfolio v2", completionPercent: 55, closedChildren: 11, totalChildren: 20),
            epicsRemaining: 1, openBeadsRemaining: 4,
            agents: agents(["working", "working", "blocked"]),
            status: "blocked",
            features: [
                FeatureRollup(id: "b1", title: "Cards", completionPercent: 60, closedChildren: 3, totalChildren: 5, agents: agents(["working", "working", "blocked"]), activityLevel: 0.72, status: "blocked"),
            ],
            activityLevel: 0.80, agentCount: 3
        ),
    ]

    /// A single project with MANY features to exercise the multi-feature tributary layout.
    static let multiFeature: [ProjectStreamRollup] = [
        ProjectStreamRollup(
            projectId: "runway", name: "Runway",
            activeEpic: ActiveEpic(id: "rwy-9", title: "Avatar bridge", completionPercent: 45, closedChildren: 9, totalChildren: 20),
            epicsRemaining: 3, openBeadsRemaining: 22,
            agents: agents(["working", "working", "idle", "working", "blocked", "working"]),
            status: "needs_input",
            features: [
                FeatureRollup(id: "r1", title: "STT", completionPercent: 80, closedChildren: 8, totalChildren: 10, agents: agents(["working", "working"]), activityLevel: 0.9, status: "on_track"),
                FeatureRollup(id: "r2", title: "TTS", completionPercent: 55, closedChildren: 5, totalChildren: 9, agents: agents(["working"]), activityLevel: 0.6, status: "on_track"),
                FeatureRollup(id: "r3", title: "PiP", completionPercent: 30, closedChildren: 3, totalChildren: 10, agents: agents(["blocked"]), activityLevel: 0.3, status: "blocked"),
                FeatureRollup(id: "r4", title: "Transport", completionPercent: 15, closedChildren: 1, totalChildren: 7, agents: [], activityLevel: 0.05, status: "needs_input"),
            ],
            activityLevel: 0.7, agentCount: 6
        ),
    ]

    static func totals(_ projects: [ProjectStreamRollup]) -> PortfolioTotals {
        PortfolioTotals(
            projects: projects.count,
            agentsActive: projects.reduce(0) { $0 + $1.agentCount },
            epicsRemaining: projects.reduce(0) { $0 + $1.epicsRemaining },
            openBeadsRemaining: projects.reduce(0) { $0 + $1.openBeadsRemaining },
            blocked: projects.filter { $0.status == "blocked" }.count,
            needsInput: projects.filter { $0.status == "needs_input" }.count,
            portfolioCompletionPercent: projects.isEmpty ? 0 :
                projects.reduce(0) { $0 + ($1.activeEpic?.completionPercent ?? 0) } / Double(projects.count)
        )
    }
}

#Preview("Mission Control — LOW intensity") {
    MissionControlMapView(projects: MissionControlPreviewData.low, totals: MissionControlPreviewData.totals(MissionControlPreviewData.low))
        .frame(height: 560)
        .background(CRTTheme.ColorTheme.starcraft.background.screen)
        .crtTheme(.starcraft)
}

#Preview("Mission Control — HIGH intensity") {
    MissionControlMapView(projects: MissionControlPreviewData.high, totals: MissionControlPreviewData.totals(MissionControlPreviewData.high))
        .frame(height: 560)
        .background(CRTTheme.ColorTheme.starcraft.background.screen)
        .crtTheme(.starcraft)
}

#Preview("Mission Control — multi-feature stream") {
    MissionControlMapView(projects: MissionControlPreviewData.multiFeature, totals: MissionControlPreviewData.totals(MissionControlPreviewData.multiFeature))
        .frame(height: 560)
        .background(CRTTheme.ColorTheme.starcraft.background.screen)
        .crtTheme(.starcraft)
}

#Preview("Mission Control — Empty") {
    MissionControlMapView(projects: [], totals: PortfolioTotals(
        projects: 0, agentsActive: 0, epicsRemaining: 0, openBeadsRemaining: 0,
        blocked: 0, needsInput: 0, portfolioCompletionPercent: 0
    ))
    .frame(height: 560)
    .background(CRTTheme.ColorTheme.starcraft.background.screen)
    .crtTheme(.starcraft)
}
#endif
