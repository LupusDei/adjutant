import SwiftUI

// MARK: - CRTCard

/// A container view with CRT-style borders and glow effects.
///
/// `CRTCard` provides a panel-style container that can hold any content,
/// with optional header and decorative corner brackets.
///
/// ## Example Usage
/// ```swift
/// CRTCard {
///     VStack {
///         CRTText("Content here")
///     }
/// }
///
/// CRTCard(header: "MAIL") {
///     MailListView()
/// }
/// .crtCardStyle(.elevated)
/// ```
public struct CRTCard<Content: View>: View {
    @Environment(\.crtTheme) private var theme

    private let header: String?
    private let headerBadge: String?
    private let style: Style
    private let showCornerBrackets: Bool
    private let content: () -> Content

    /// Card visual styles
    public enum Style {
        case standard   // Basic bordered card
        case elevated   // Slightly raised with stronger glow
        case minimal    // Subtle borders, no glow

        var backgroundOpacity: Double {
            switch self {
            case .standard: return 0.4
            case .elevated: return 0.6
            case .minimal: return 0.2
            }
        }

        var borderOpacity: Double {
            switch self {
            case .standard: return 0.6
            case .elevated: return 0.8
            case .minimal: return 0.3
            }
        }

        var glowIntensity: Double {
            switch self {
            case .standard: return 0.2
            case .elevated: return 0.4
            case .minimal: return 0
            }
        }
    }

    /// Creates a CRT-styled card container.
    /// - Parameters:
    ///   - header: Optional header text displayed at the top
    ///   - headerBadge: Optional badge text displayed next to the header
    ///   - style: The visual style (default: `.standard`)
    ///   - showCornerBrackets: Whether to show decorative corner brackets (default: `true`)
    ///   - content: The content to display inside the card
    public init(
        header: String? = nil,
        headerBadge: String? = nil,
        style: Style = .standard,
        showCornerBrackets: Bool = true,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.header = header
        self.headerBadge = headerBadge
        self.style = style
        self.showCornerBrackets = showCornerBrackets
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header = header {
                headerView(title: header, badge: headerBadge)
            }

            content()
                .padding(CRTTheme.Spacing.md)
        }
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(theme.background.panel.opacity(style.backgroundOpacity))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(theme.dim.opacity(style.borderOpacity), lineWidth: 1)
        )
        .overlay(
            cornerBracketsOverlay
        )
        .crtGlow(
            color: theme.accent,
            radius: 8,
            intensity: style.glowIntensity
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(header ?? "Card")
    }

    @ViewBuilder
    private func headerView(title: String, badge: String?) -> some View {
        HStack {
            CRTText(title, style: .subheader, glowIntensity: .subtle)

            if let badge = badge {
                Spacer()
                CRTText(badge, style: .caption, glowIntensity: .subtle)
                    .foregroundColor(theme.dim)
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(theme.primary.opacity(0.1))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.3)),
            alignment: .bottom
        )
    }

    @ViewBuilder
    private var cornerBracketsOverlay: some View {
        if showCornerBrackets {
            GeometryReader { geometry in
                ZStack {
                    // Top-left bracket
                    CornerBracket(corner: .topLeft)
                        .position(x: 12, y: 12)

                    // Top-right bracket
                    CornerBracket(corner: .topRight)
                        .position(x: geometry.size.width - 12, y: 12)

                    // Bottom-left bracket
                    CornerBracket(corner: .bottomLeft)
                        .position(x: 12, y: geometry.size.height - 12)

                    // Bottom-right bracket
                    CornerBracket(corner: .bottomRight)
                        .position(x: geometry.size.width - 12, y: geometry.size.height - 12)
                }
            }
        }
    }
}

// MARK: - Corner Bracket

/// Decorative corner bracket for CRT-style UI
private struct CornerBracket: View {
    @Environment(\.crtTheme) private var theme

    enum Corner {
        case topLeft, topRight, bottomLeft, bottomRight
    }

    let corner: Corner
    let size: CGFloat = 16
    let lineWidth: CGFloat = 1.5

    var body: some View {
        Path { path in
            switch corner {
            case .topLeft:
                path.move(to: CGPoint(x: 0, y: size))
                path.addLine(to: CGPoint(x: 0, y: 0))
                path.addLine(to: CGPoint(x: size, y: 0))
            case .topRight:
                path.move(to: CGPoint(x: -size, y: 0))
                path.addLine(to: CGPoint(x: 0, y: 0))
                path.addLine(to: CGPoint(x: 0, y: size))
            case .bottomLeft:
                path.move(to: CGPoint(x: 0, y: -size))
                path.addLine(to: CGPoint(x: 0, y: 0))
                path.addLine(to: CGPoint(x: size, y: 0))
            case .bottomRight:
                path.move(to: CGPoint(x: -size, y: 0))
                path.addLine(to: CGPoint(x: 0, y: 0))
                path.addLine(to: CGPoint(x: 0, y: -size))
            }
        }
        .stroke(theme.dim.opacity(0.5), lineWidth: lineWidth)
    }
}

// MARK: - Modifiers

extension CRTCard {
    /// Sets the card style
    public func crtCardStyle(_ style: Style) -> CRTCard {
        CRTCard(
            header: header,
            headerBadge: headerBadge,
            style: style,
            showCornerBrackets: showCornerBrackets,
            content: content
        )
    }
}

// MARK: - Preview

#Preview("CRTCard Styles") {
    ScrollView {
        VStack(spacing: 20) {
            CRTCard(header: "STANDARD CARD", headerBadge: "5 ITEMS") {
                VStack(alignment: .leading, spacing: 8) {
                    CRTText("This is standard card content")
                    CRTText("With multiple lines of text", style: .caption)
                }
            }

            CRTCard(header: "ELEVATED CARD", style: .elevated) {
                CRTText("Elevated style with stronger glow")
            }

            CRTCard(header: "MINIMAL CARD", style: .minimal) {
                CRTText("Minimal style with subtle borders")
            }

            CRTCard(showCornerBrackets: false) {
                CRTText("No header, no corner brackets")
            }
        }
        .padding()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("CRTCard Themes") {
    ScrollView(.horizontal) {
        HStack(spacing: 12) {
            ForEach(CRTTheme.ColorTheme.allCases) { theme in
                CRTCard(header: theme.displayName) {
                    CRTText("Themed content", style: .body)
                }
                .frame(width: 160)
                .crtTheme(theme)
            }
        }
        .padding()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
