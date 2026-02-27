import SwiftUI

// MARK: - Scanline Overlay

/// CRT-style horizontal scanline overlay
public struct ScanlineOverlay: View {
    @Environment(\.crtTheme) private var theme

    let opacity: Double
    let lineHeight: CGFloat
    let animated: Bool

    @State private var offset: CGFloat = 0

    public init(
        opacity: Double = 0.15,
        lineHeight: CGFloat = 2,
        animated: Bool = false
    ) {
        self.opacity = opacity
        self.lineHeight = lineHeight
        self.animated = animated
    }

    public var body: some View {
        if theme.crtEffectsEnabled {
            GeometryReader { geometry in
                Canvas { context, size in
                    let lineCount = Int(size.height / (lineHeight * 2)) + 1
                    for i in 0..<lineCount {
                        let y = CGFloat(i) * lineHeight * 2 + lineHeight + (animated ? offset : 0)
                        let rect = CGRect(x: 0, y: y, width: size.width, height: lineHeight)
                        context.fill(Path(rect), with: .color(.black.opacity(opacity)))
                    }
                }
                .onAppear {
                    guard animated else { return }
                    withAnimation(.linear(duration: 0.05).repeatForever(autoreverses: false)) {
                        offset = lineHeight * 2
                    }
                }
            }
            .allowsHitTesting(false)
        }
    }
}

// MARK: - Rolling Scan Bar

/// Animated rolling scan bar effect like CRT refresh
public struct ScanBarOverlay: View {
    @Environment(\.crtTheme) private var theme

    @State private var position: CGFloat = -8

    public init() {}

    public var body: some View {
        if theme.crtEffectsEnabled {
            GeometryReader { geometry in
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: theme.primary.opacity(0.1), location: 0.4),
                        .init(color: theme.primary.opacity(0.15), location: 0.5),
                        .init(color: theme.primary.opacity(0.1), location: 0.6),
                        .init(color: .clear, location: 1)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 8)
                .offset(y: position)
                .onAppear {
                    withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) {
                        position = geometry.size.height
                    }
                }
            }
            .allowsHitTesting(false)
        }
    }
}

// MARK: - Flicker Effect

/// CRT screen flicker effect modifier
public struct FlickerEffect: ViewModifier {
    @Environment(\.crtTheme) private var theme
    @State private var opacity: Double = 1.0
    @State private var timer: Timer?

    let enabled: Bool
    let intensity: ClosedRange<Double>

    public init(enabled: Bool = true, intensity: ClosedRange<Double> = 0.97...1.0) {
        self.enabled = enabled
        self.intensity = intensity
    }

    public func body(content: Content) -> some View {
        let effectivelyEnabled = enabled && theme.crtEffectsEnabled
        content
            .opacity(effectivelyEnabled ? opacity : 1.0)
            .onAppear {
                guard effectivelyEnabled else { return }
                startFlicker()
            }
            .onDisappear {
                timer?.invalidate()
                timer = nil
            }
    }

    private func startFlicker() {
        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in
            withAnimation(.linear(duration: 0.05)) {
                opacity = Double.random(in: intensity)
            }
        }
    }
}

extension View {
    /// Apply CRT flicker effect
    public func crtFlicker(enabled: Bool = true) -> some View {
        modifier(FlickerEffect(enabled: enabled))
    }
}

// MARK: - Phosphor Glow

/// Glow effect for CRT phosphor simulation
public struct PhosphorGlow: ViewModifier {
    let theme: CRTTheme.ColorTheme
    let radius: CGFloat

    public init(theme: CRTTheme.ColorTheme, radius: CGFloat = 4) {
        self.theme = theme
        self.radius = radius
    }

    public func body(content: Content) -> some View {
        if theme.crtEffectsEnabled {
            content
                .shadow(color: theme.bright, radius: radius / 2, x: 0, y: 0)
                .shadow(color: theme.bright, radius: radius, x: 0, y: 0)
        } else {
            content
        }
    }
}

extension View {
    /// Apply phosphor glow effect
    public func phosphorGlow(_ theme: CRTTheme.ColorTheme, radius: CGFloat = 4) -> some View {
        modifier(PhosphorGlow(theme: theme, radius: radius))
    }
}

// MARK: - Text Glow

/// Text shadow glow for CRT text
public struct TextGlow: ViewModifier {
    let theme: CRTTheme.ColorTheme
    let size: GlowSize

    public enum GlowSize {
        case small
        case medium
        case large

        var radii: (inner: CGFloat, outer: CGFloat) {
            switch self {
            case .small: return (2, 4)
            case .medium: return (4, 8)
            case .large: return (8, 16)
            }
        }
    }

    public init(theme: CRTTheme.ColorTheme, size: GlowSize = .medium) {
        self.theme = theme
        self.size = size
    }

    public func body(content: Content) -> some View {
        if theme.crtEffectsEnabled {
            content
                .shadow(color: theme.primary, radius: size.radii.inner, x: 0, y: 0)
                .shadow(color: theme.bright, radius: size.radii.outer, x: 0, y: 0)
        } else {
            content
        }
    }
}

extension View {
    /// Apply CRT text glow
    public func crtGlow(_ theme: CRTTheme.ColorTheme, size: TextGlow.GlowSize = .medium) -> some View {
        modifier(TextGlow(theme: theme, size: size))
    }
}

// MARK: - Noise Overlay

/// Static noise overlay for CRT effect
public struct NoiseOverlay: View {
    @Environment(\.crtTheme) private var theme

    let opacity: Double

    @State private var phase: Int = 0
    @State private var timer: Timer?

    public init(opacity: Double = 0.03) {
        self.opacity = opacity
    }

    public var body: some View {
        if theme.crtEffectsEnabled {
            Canvas { context, size in
                for _ in 0..<Int(size.width * size.height * 0.001) {
                    let x = CGFloat.random(in: 0..<size.width)
                    let y = CGFloat.random(in: 0..<size.height)
                    let noiseOpacity = Double.random(in: 0...opacity)
                    let rect = CGRect(x: x, y: y, width: 1, height: 1)
                    context.fill(Path(rect), with: .color(.white.opacity(noiseOpacity)))
                }
            }
            .allowsHitTesting(false)
            .id(phase)
            .onAppear {
                timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
                    phase = (phase + 1) % 5
                }
            }
            .onDisappear {
                timer?.invalidate()
                timer = nil
            }
        }
    }
}

// MARK: - Vignette Effect

/// Edge darkening vignette for CRT screen edges
public struct VignetteOverlay: View {
    @Environment(\.crtTheme) private var theme

    let intensity: Double

    public init(intensity: Double = 0.4) {
        self.intensity = intensity
    }

    public var body: some View {
        if theme.crtEffectsEnabled {
            GeometryReader { geometry in
                RadialGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .clear, location: 0.5),
                        .init(color: .black.opacity(intensity), location: 0.8),
                        .init(color: .black.opacity(intensity * 2), location: 1)
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: geometry.size.width * 0.8
                )
            }
            .allowsHitTesting(false)
        }
    }
}

// MARK: - CRT Screen Container

/// Complete CRT screen wrapper with all effects
public struct CRTScreenContainer<Content: View>: View {
    @Environment(\.crtTheme) private var theme

    let content: () -> Content
    let enableScanlines: Bool
    let enableFlicker: Bool
    let enableNoise: Bool
    let enableVignette: Bool

    public init(
        enableScanlines: Bool = true,
        enableFlicker: Bool = true,
        enableNoise: Bool = true,
        enableVignette: Bool = true,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.content = content
        self.enableScanlines = enableScanlines
        self.enableFlicker = enableFlicker
        self.enableNoise = enableNoise
        self.enableVignette = enableVignette
    }

    public var body: some View {
        ZStack {
            // Background - scheme-aware
            theme.background.screen
                .ignoresSafeArea()

            // Content with glow border
            content()

            // Effect overlays - AND with theme.crtEffectsEnabled
            if enableScanlines && theme.crtEffectsEnabled {
                ScanlineOverlay(animated: true)
                ScanBarOverlay()
            }

            if enableNoise && theme.crtEffectsEnabled {
                NoiseOverlay()
            }

            if enableVignette && theme.crtEffectsEnabled {
                VignetteOverlay()
            }

            // StarCraft-specific dynamic effects
            if theme == .starcraft {
                LightningOverlay()
                AmbientGlowOverlay()
            }
        }
        .crtFlicker(enabled: enableFlicker)
    }
}

// MARK: - Screen Glare

/// Subtle glass reflection effect
public struct ScreenGlare: View {
    @Environment(\.crtTheme) private var theme

    public init() {}

    public var body: some View {
        if theme.crtEffectsEnabled {
            LinearGradient(
                stops: [
                    .init(color: .white.opacity(0.03), location: 0),
                    .init(color: .clear, location: 0.3),
                    .init(color: .clear, location: 0.7),
                    .init(color: .white.opacity(0.01), location: 1)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .allowsHitTesting(false)
        }
    }
}

// MARK: - Pulsing Glow Animation

/// Pulsing glow for active/working status indicators
public struct PulsingGlow: ViewModifier {
    let theme: CRTTheme.ColorTheme

    @State private var isPulsing = false

    public init(theme: CRTTheme.ColorTheme) {
        self.theme = theme
    }

    public func body(content: Content) -> some View {
        if theme.crtEffectsEnabled {
            content
                .shadow(color: theme.bright.opacity(isPulsing ? 0.8 : 0.4), radius: isPulsing ? 8 : 4)
                .onAppear {
                    withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                        isPulsing = true
                    }
                }
        } else {
            // Document: subtle static shadow instead of pulsing
            content
                .shadow(color: theme.dim.opacity(0.2), radius: 2)
        }
    }
}

extension View {
    /// Apply pulsing glow for active states
    public func pulsingGlow(_ theme: CRTTheme.ColorTheme) -> some View {
        modifier(PulsingGlow(theme: theme))
    }
}

// MARK: - StarCraft Lightning Strike Effect

/// Occasional subtle electrical discharge across the screen — StarCraft only.
/// Renders brief forking lightning bolts that flash and fade at random intervals.
public struct LightningOverlay: View {
    @Environment(\.crtTheme) private var theme

    @State private var bolts: [LightningBolt] = []
    @State private var timer: Timer?

    public init() {}

    public var body: some View {
        if theme == .starcraft {
            GeometryReader { geometry in
                ZStack {
                    ForEach(bolts) { bolt in
                        LightningBoltShape(bolt: bolt, bounds: geometry.size)
                            .stroke(theme.bright.opacity(bolt.opacity), lineWidth: bolt.width)
                            .shadow(color: theme.primary.opacity(bolt.opacity * 0.6), radius: 8)
                            .shadow(color: theme.bright.opacity(bolt.opacity * 0.3), radius: 16)
                    }
                }
                .onAppear { startLightning(bounds: geometry.size) }
                .onDisappear { stopLightning() }
            }
            .allowsHitTesting(false)
        }
    }

    private func startLightning(bounds: CGSize) {
        timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in
            // ~8% chance per tick = roughly one strike every 4 seconds
            guard Double.random(in: 0...1) < 0.08 else { return }

            let bolt = LightningBolt(
                id: UUID(),
                startX: CGFloat.random(in: 0.1...0.9),
                startY: CGFloat.random(in: 0...0.3),
                segments: Int.random(in: 4...7),
                width: CGFloat.random(in: 0.5...1.5),
                opacity: Double.random(in: 0.15...0.35),
                seed: UInt64.random(in: 0...UInt64.max)
            )
            bolts.append(bolt)

            // Fade and remove after brief flash
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                withAnimation(.easeOut(duration: 0.15)) {
                    bolts.removeAll { $0.id == bolt.id }
                }
            }
        }
    }

    private func stopLightning() {
        timer?.invalidate()
        timer = nil
    }
}

/// Data for a single lightning bolt
private struct LightningBolt: Identifiable {
    let id: UUID
    let startX: CGFloat   // 0-1 fraction of width
    let startY: CGFloat   // 0-1 fraction of height
    let segments: Int
    let width: CGFloat
    var opacity: Double
    let seed: UInt64
}

/// Shape that draws a forking lightning bolt path
private struct LightningBoltShape: Shape {
    let bolt: LightningBolt
    let bounds: CGSize

    func path(in rect: CGRect) -> Path {
        var path = Path()
        var rng = SeededRNG(seed: bolt.seed)

        let startX = bounds.width * bolt.startX
        let startY = bounds.height * bolt.startY
        var currentPoint = CGPoint(x: startX, y: startY)

        path.move(to: currentPoint)

        let segmentLength = bounds.height * 0.12

        for _ in 0..<bolt.segments {
            let dx = CGFloat.random(in: -segmentLength * 0.6...segmentLength * 0.6, using: &rng)
            let dy = CGFloat.random(in: segmentLength * 0.4...segmentLength, using: &rng)
            let nextPoint = CGPoint(x: currentPoint.x + dx, y: currentPoint.y + dy)
            path.addLine(to: nextPoint)
            currentPoint = nextPoint
        }

        return path
    }
}

/// Simple seeded RNG for deterministic bolt shapes within a frame
private struct SeededRNG: RandomNumberGenerator {
    var state: UInt64

    init(seed: UInt64) {
        self.state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

// MARK: - StarCraft Ambient Glow Pulse

/// Enhanced pulsating border/edge glow specific to StarCraft theme.
/// Creates a breathing ambient glow around the screen edges.
public struct AmbientGlowOverlay: View {
    @Environment(\.crtTheme) private var theme

    @State private var phase: Double = 0

    public init() {}

    public var body: some View {
        if theme == .starcraft {
            GeometryReader { geometry in
                ZStack {
                    // Edge glow — pulsates between dim and bright
                    RoundedRectangle(cornerRadius: 0)
                        .strokeBorder(
                            LinearGradient(
                                colors: [
                                    theme.primary.opacity(0.0),
                                    theme.primary.opacity(0.08 + phase * 0.06),
                                    theme.bright.opacity(0.04 + phase * 0.04),
                                    theme.primary.opacity(0.08 + phase * 0.06),
                                    theme.primary.opacity(0.0)
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            ),
                            lineWidth: 2
                        )
                        .shadow(color: theme.primary.opacity(0.1 + phase * 0.08), radius: 12)
                        .shadow(color: theme.bright.opacity(0.03 + phase * 0.03), radius: 24)
                }
            }
            .allowsHitTesting(false)
            .onAppear {
                withAnimation(.easeInOut(duration: 3.0).repeatForever(autoreverses: true)) {
                    phase = 1.0
                }
            }
        }
    }
}
