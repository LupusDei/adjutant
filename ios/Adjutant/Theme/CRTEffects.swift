import SwiftUI

// MARK: - Scanline Overlay

/// CRT-style horizontal scanline overlay
public struct ScanlineOverlay: View {
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

// MARK: - Rolling Scan Bar

/// Animated rolling scan bar effect like CRT refresh
public struct ScanBarOverlay: View {
    @Environment(\.crtTheme) private var theme

    @State private var position: CGFloat = -8

    public init() {}

    public var body: some View {
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

// MARK: - Flicker Effect

/// CRT screen flicker effect modifier
public struct FlickerEffect: ViewModifier {
    @State private var opacity: Double = 1.0

    let enabled: Bool
    let intensity: ClosedRange<Double>

    public init(enabled: Bool = true, intensity: ClosedRange<Double> = 0.97...1.0) {
        self.enabled = enabled
        self.intensity = intensity
    }

    public func body(content: Content) -> some View {
        content
            .opacity(enabled ? opacity : 1.0)
            .onAppear {
                guard enabled else { return }
                startFlicker()
            }
    }

    private func startFlicker() {
        Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { _ in
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
    let theme: CRTTheme
    let radius: CGFloat

    public init(theme: CRTTheme, radius: CGFloat = 4) {
        self.theme = theme
        self.radius = radius
    }

    public func body(content: Content) -> some View {
        content
            .shadow(color: theme.glow, radius: radius / 2, x: 0, y: 0)
            .shadow(color: theme.glow, radius: radius, x: 0, y: 0)
    }
}

extension View {
    /// Apply phosphor glow effect
    public func phosphorGlow(_ theme: CRTTheme, radius: CGFloat = 4) -> some View {
        modifier(PhosphorGlow(theme: theme, radius: radius))
    }
}

// MARK: - Text Glow

/// Text shadow glow for CRT text
public struct TextGlow: ViewModifier {
    let theme: CRTTheme
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

    public init(theme: CRTTheme, size: GlowSize = .medium) {
        self.theme = theme
        self.size = size
    }

    public func body(content: Content) -> some View {
        content
            .shadow(color: theme.primary, radius: size.radii.inner, x: 0, y: 0)
            .shadow(color: theme.glow, radius: size.radii.outer, x: 0, y: 0)
    }
}

extension View {
    /// Apply CRT text glow
    public func crtGlow(_ theme: CRTTheme, size: TextGlow.GlowSize = .medium) -> some View {
        modifier(TextGlow(theme: theme, size: size))
    }
}

// MARK: - Noise Overlay

/// Static noise overlay for CRT effect
public struct NoiseOverlay: View {
    let opacity: Double

    @State private var phase: Int = 0

    public init(opacity: Double = 0.03) {
        self.opacity = opacity
    }

    public var body: some View {
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
            Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
                phase = (phase + 1) % 5
            }
        }
    }
}

// MARK: - Vignette Effect

/// Edge darkening vignette for CRT screen edges
public struct VignetteOverlay: View {
    let intensity: Double

    public init(intensity: Double = 0.4) {
        self.intensity = intensity
    }

    public var body: some View {
        RadialGradient(
            stops: [
                .init(color: .clear, location: 0),
                .init(color: .clear, location: 0.5),
                .init(color: .black.opacity(intensity), location: 0.8),
                .init(color: .black.opacity(intensity * 2), location: 1)
            ],
            center: .center,
            startRadius: 0,
            endRadius: UIScreen.main.bounds.width * 0.8
        )
        .allowsHitTesting(false)
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
            // Background
            CRTTheme.screenBackground
                .ignoresSafeArea()

            // Content with glow border
            content()

            // Effect overlays
            if enableScanlines {
                ScanlineOverlay(animated: true)
                ScanBarOverlay()
            }

            if enableNoise {
                NoiseOverlay()
            }

            if enableVignette {
                VignetteOverlay()
            }
        }
        .crtFlicker(enabled: enableFlicker)
    }
}

// MARK: - Screen Glare

/// Subtle glass reflection effect
public struct ScreenGlare: View {
    public init() {}

    public var body: some View {
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

// MARK: - Pulsing Glow Animation

/// Pulsing glow for active/working status indicators
public struct PulsingGlow: ViewModifier {
    let theme: CRTTheme

    @State private var isPulsing = false

    public init(theme: CRTTheme) {
        self.theme = theme
    }

    public func body(content: Content) -> some View {
        content
            .shadow(color: theme.bright.opacity(isPulsing ? 0.8 : 0.4), radius: isPulsing ? 8 : 4)
            .onAppear {
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                    isPulsing = true
                }
            }
    }
}

extension View {
    /// Apply pulsing glow for active states
    public func pulsingGlow(_ theme: CRTTheme) -> some View {
        modifier(PulsingGlow(theme: theme))
    }
}
