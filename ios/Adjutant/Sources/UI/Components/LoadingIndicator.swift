import SwiftUI

// MARK: - LoadingIndicator

/// A loading indicator with CRT-style phosphor glow animation.
///
/// `LoadingIndicator` provides a retro terminal-style spinner with
/// configurable size and optional loading text.
///
/// ## Example Usage
/// ```swift
/// LoadingIndicator()
///
/// LoadingIndicator(size: .large, text: "LOADING...")
///
/// LoadingIndicator(size: .small)
///     .crtTheme(.starcraft)
/// ```
public struct LoadingIndicator: View {
    @Environment(\.crtTheme) private var theme
    @State private var isAnimating = false
    @State private var dotCount = 0

    private let size: Size
    private let text: String?

    /// Loading indicator size presets
    public enum Size {
        case small
        case medium
        case large

        var diameter: CGFloat {
            switch self {
            case .small: return 16
            case .medium: return 32
            case .large: return 48
            }
        }

        var lineWidth: CGFloat {
            switch self {
            case .small: return 2
            case .medium: return 3
            case .large: return 4
            }
        }

        var fontSize: CGFloat {
            switch self {
            case .small: return 10
            case .medium: return 14
            case .large: return 18
            }
        }
    }

    /// Creates a CRT-styled loading indicator.
    /// - Parameters:
    ///   - size: The indicator size (default: `.medium`)
    ///   - text: Optional loading text to display
    public init(size: Size = .medium, text: String? = nil) {
        self.size = size
        self.text = text
    }

    public var body: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            spinnerView

            if let text = text {
                animatedTextView(text: text)
            }
        }
        .accessibilityLabel(text ?? "Loading")
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var spinnerView: some View {
        ZStack {
            // Background track
            Circle()
                .stroke(theme.dim.opacity(0.3), lineWidth: size.lineWidth)
                .frame(width: size.diameter, height: size.diameter)

            // Animated arc
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(
                    AngularGradient(
                        colors: [
                            theme.primary.opacity(0.1),
                            theme.primary.opacity(0.5),
                            theme.primary
                        ],
                        center: .center,
                        startAngle: .degrees(0),
                        endAngle: .degrees(360)
                    ),
                    style: StrokeStyle(lineWidth: size.lineWidth, lineCap: .round)
                )
                .frame(width: size.diameter, height: size.diameter)
                .rotationEffect(.degrees(isAnimating ? 360 : 0))
                .animation(
                    .linear(duration: 1.0).repeatForever(autoreverses: false),
                    value: isAnimating
                )
                .crtGlow(color: theme.primary, radius: 4, intensity: 0.5)
        }
        .onAppear {
            isAnimating = true
        }
    }

    private func animatedTextView(text: String) -> some View {
        HStack(spacing: 0) {
            Text(text.uppercased())
                .font(CRTTheme.Typography.font(size: size.fontSize, weight: .medium, theme: theme))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(theme.primary)

            // Animated dots
            Text(String(repeating: ".", count: dotCount))
                .font(CRTTheme.Typography.font(size: size.fontSize, weight: .medium, theme: theme))
                .foregroundColor(theme.primary)
                .frame(width: 24, alignment: .leading)
        }
        .crtGlow(color: theme.primary, radius: 2, intensity: 0.3)
        .onAppear {
            startDotAnimation()
        }
    }

    private func startDotAnimation() {
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            withAnimation {
                dotCount = (dotCount + 1) % 4
            }
        }
    }
}

// MARK: - Inline Loading Indicator

/// A compact inline loading indicator for use within buttons or text.
public struct InlineLoadingIndicator: View {
    @Environment(\.crtTheme) private var theme
    @State private var isAnimating = false

    public init() {}

    public var body: some View {
        Circle()
            .trim(from: 0, to: 0.6)
            .stroke(theme.primary, lineWidth: 2)
            .frame(width: 12, height: 12)
            .rotationEffect(.degrees(isAnimating ? 360 : 0))
            .animation(
                .linear(duration: 0.8).repeatForever(autoreverses: false),
                value: isAnimating
            )
            .onAppear {
                isAnimating = true
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Skeleton Loading View

/// A skeleton placeholder view for content that is loading.
public struct SkeletonView: View {
    @Environment(\.crtTheme) private var theme
    @State private var isAnimating = false

    let width: CGFloat?
    let height: CGFloat

    /// Creates a skeleton loading placeholder.
    /// - Parameters:
    ///   - width: The width of the skeleton (nil for full width)
    ///   - height: The height of the skeleton
    public init(width: CGFloat? = nil, height: CGFloat = 16) {
        self.width = width
        self.height = height
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
            .fill(theme.dim.opacity(0.2))
            .frame(width: width, height: height)
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(
                        LinearGradient(
                            colors: [
                                .clear,
                                theme.primary.opacity(0.1),
                                .clear
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .offset(x: isAnimating ? 200 : -200)
            )
            .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm))
            .animation(
                .linear(duration: 1.5).repeatForever(autoreverses: false),
                value: isAnimating
            )
            .onAppear {
                isAnimating = true
            }
            .accessibilityLabel("Loading content")
    }
}

// MARK: - Preview

#Preview("LoadingIndicator Sizes") {
    VStack(spacing: 32) {
        LoadingIndicator(size: .small)
        LoadingIndicator(size: .medium)
        LoadingIndicator(size: .large)
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("LoadingIndicator with Text") {
    VStack(spacing: 32) {
        LoadingIndicator(text: "LOADING")
        LoadingIndicator(size: .large, text: "PLEASE WAIT")
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("LoadingIndicator Themes") {
    HStack(spacing: 24) {
        ForEach(CRTTheme.ColorTheme.allCases) { theme in
            LoadingIndicator(size: .medium)
                .crtTheme(theme)
        }
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("Skeleton Views") {
    VStack(alignment: .leading, spacing: 12) {
        SkeletonView(height: 24)
        SkeletonView(width: 200, height: 16)
        SkeletonView(width: 150, height: 16)
        SkeletonView(height: 80)
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
