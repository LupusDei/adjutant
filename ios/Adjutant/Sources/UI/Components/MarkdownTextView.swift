import SwiftUI

/// Renders a markdown string as themed SwiftUI views.
///
/// Supports headers, code blocks, blockquotes, lists, horizontal rules,
/// and inline formatting (bold, italic, inline code, links).
/// Respects the current CRT theme for all styling.
struct MarkdownTextView: View {
    @Environment(\.crtTheme) private var theme

    private let blocks: [MarkdownBlock]
    private let fontSize: CGFloat

    init(_ markdown: String, fontSize: CGFloat = 14) {
        self.blocks = MarkdownParser.parse(markdown)
        self.fontSize = fontSize
    }

    var body: some View {
        // Single paragraph: render as inline Text for compact layout
        if blocks.count == 1, case .paragraph(let inlines) = blocks[0] {
            inlineText(inlines, size: fontSize)
        } else {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    blockView(block)
                }
            }
        }
    }

    // MARK: - Block Views

    @ViewBuilder
    private func blockView(_ block: MarkdownBlock) -> some View {
        switch block {
        case .paragraph(let inlines):
            inlineText(inlines, size: fontSize)

        case .heading(let level, let inlines):
            let headingSize: CGFloat = {
                switch level {
                case 1: return fontSize + 6
                case 2: return fontSize + 4
                default: return fontSize + 2
                }
            }()
            inlineText(inlines, size: headingSize, weight: .bold)

        case .codeBlock(_, let code):
            Text(code)
                .font(.system(size: fontSize - 1, weight: .regular, design: .monospaced))
                .foregroundColor(theme.bright)
                .padding(CRTTheme.Spacing.xs)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .fill(theme.background.panel)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                        .stroke(theme.dim.opacity(0.3), lineWidth: 1)
                )

        case .blockquote(let innerBlocks):
            HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(theme.dim.opacity(0.5))
                    .frame(width: 2)
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                    ForEach(Array(innerBlocks.enumerated()), id: \.offset) { _, inner in
                        blockquoteContent(inner)
                    }
                }
            }

        case .unorderedList(let items):
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: CRTTheme.Spacing.xxs) {
                        Text("\u{2022}")
                            .font(CRTTheme.Typography.font(size: fontSize, theme: theme))
                            .foregroundColor(theme.dim)
                        inlineText(item, size: fontSize)
                    }
                }
            }

        case .orderedList(let items):
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                ForEach(Array(items.enumerated()), id: \.offset) { idx, item in
                    HStack(alignment: .top, spacing: CRTTheme.Spacing.xxs) {
                        Text("\(idx + 1).")
                            .font(CRTTheme.Typography.font(size: fontSize, theme: theme))
                            .foregroundColor(theme.dim)
                            .frame(minWidth: 20, alignment: .trailing)
                        inlineText(item, size: fontSize)
                    }
                }
            }

        case .horizontalRule:
            Rectangle()
                .fill(theme.dim.opacity(0.4))
                .frame(height: 1)
                .padding(.vertical, CRTTheme.Spacing.xxxs)
        }
    }

    /// Renders inner blockquote content without recursion.
    @ViewBuilder
    private func blockquoteContent(_ block: MarkdownBlock) -> some View {
        switch block {
        case .paragraph(let inlines):
            inlineText(inlines, size: fontSize)
                .foregroundColor(theme.dim)
        case .heading(_, let inlines):
            inlineText(inlines, size: fontSize, weight: .bold)
                .foregroundColor(theme.dim)
        default:
            // For non-paragraph blocks inside quotes, render as plain text
            EmptyView()
        }
    }

    // MARK: - Inline Text

    private func inlineText(
        _ inlines: [MarkdownInline],
        size: CGFloat,
        weight: Font.Weight = .regular
    ) -> Text {
        inlines.reduce(Text("")) { result, element in
            result + inlineElement(element, size: size, baseWeight: weight)
        }
    }

    private func inlineElement(
        _ element: MarkdownInline,
        size: CGFloat,
        baseWeight: Font.Weight
    ) -> Text {
        switch element {
        case .text(let str):
            return Text(str)
                .font(CRTTheme.Typography.font(size: size, weight: baseWeight, theme: theme))

        case .bold(let str):
            return Text(str)
                .font(CRTTheme.Typography.font(size: size, weight: .bold, theme: theme))

        case .italic(let str):
            return Text(str)
                .font(CRTTheme.Typography.font(size: size, weight: baseWeight, theme: theme))
                .italic()

        case .boldItalic(let str):
            return Text(str)
                .font(CRTTheme.Typography.font(size: size, weight: .bold, theme: theme))
                .italic()

        case .code(let str):
            return Text(str)
                .font(.system(size: size, weight: .regular, design: .monospaced))
                .foregroundColor(theme.bright)

        case .link(let text, _):
            return Text(text)
                .font(CRTTheme.Typography.font(size: size, weight: baseWeight, theme: theme))
                .foregroundColor(theme.accent)
                .underline()
        }
    }
}

// MARK: - Preview

#Preview("Markdown Rendering") {
    ScrollView {
        VStack(alignment: .leading, spacing: 20) {
            // Agent-style message with formatting
            MarkdownTextView("""
            **What changed:**
            - Outgoing messages: timestamp appears to the **left** of the bubble
            - Incoming messages: timestamp appears to the **right**
            - Format: `8:02pm` for today, `2/26 8:02pm` for this year

            Font size 10, very dim opacity so they don't compete with message text.
            """)

            Divider()

            // Code block example
            MarkdownTextView("""
            Here's a code example:

            ```swift
            let greeting = "Hello, World!"
            print(greeting)
            ```

            That's all you need.
            """)

            Divider()

            // Headers and lists
            MarkdownTextView("""
            ## Status Update

            ### Completed
            1. Parser implementation
            2. Renderer integration
            3. Theme support

            > This was a *complex* task but it's **done** now.

            ---

            ***Important:*** Rebuild in Xcode to see changes.
            """)
        }
        .foregroundColor(CRTTheme.ColorTheme.pipboy.primary)
        .padding()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
