import SwiftUI

// MARK: - Keyboard Dismiss Toolbar

/// Adds a small down-chevron button to the keyboard toolbar for dismissing the keyboard.
/// Apply to any text input view to get a consistent, compact dismiss affordance.
struct KeyboardDismissToolbar: ViewModifier {
    @Environment(\.crtTheme) private var theme

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder),
                            to: nil, from: nil, for: nil
                        )
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(theme.primary)
                    }
                }
            }
    }
}

extension View {
    func keyboardDismissToolbar() -> some View {
        modifier(KeyboardDismissToolbar())
    }
}

// MARK: - CRTTextField

/// A text input field styled with CRT phosphor effects.
///
/// `CRTTextField` provides a retro terminal-style single-line text input
/// with focus state animations and themed styling.
///
/// ## Example Usage
/// ```swift
/// @State private var subject = ""
///
/// CRTTextField("Subject", text: $subject)
///
/// CRTTextField("Search", text: $query, icon: "magnifyingglass")
/// ```
public struct CRTTextField: View {
    @Environment(\.crtTheme) private var theme
    @FocusState private var isFocused: Bool

    private let placeholder: String
    @Binding private var text: String
    private let icon: String?
    private let onSubmit: (() -> Void)?

    /// Creates a CRT-styled text field.
    /// - Parameters:
    ///   - placeholder: Placeholder text when empty
    ///   - text: Binding to the text value
    ///   - icon: Optional SF Symbol name for leading icon
    ///   - onSubmit: Optional action when return key is pressed
    public init(
        _ placeholder: String,
        text: Binding<String>,
        icon: String? = nil,
        onSubmit: (() -> Void)? = nil
    ) {
        self.placeholder = placeholder
        self._text = text
        self.icon = icon
        self.onSubmit = onSubmit
    }

    public var body: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            if let icon = icon {
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundColor(isFocused ? theme.primary : theme.dim)
            }

            TextField("", text: $text, prompt: promptText)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                .focused($isFocused)
                .onSubmit {
                    onSubmit?()
                }
                .keyboardDismissToolbar()
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(CRTTheme.Background.elevated.opacity(isFocused ? 0.8 : 0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(borderColor, lineWidth: isFocused ? 2 : 1)
        )
        .crtGlow(
            color: theme.primary,
            radius: isFocused ? 6 : 0,
            intensity: isFocused ? 0.3 : 0
        )
        .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isFocused)
        .accessibilityLabel(placeholder)
        .accessibilityValue(text.isEmpty ? "Empty" : text)
    }

    private var promptText: Text {
        Text(placeholder.uppercased())
            .foregroundColor(theme.dim.opacity(0.6))
    }

    private var borderColor: Color {
        isFocused ? theme.primary : theme.dim.opacity(0.5)
    }
}

// MARK: - CRTTextEditor

/// A multi-line text editor styled with CRT phosphor effects.
///
/// `CRTTextEditor` provides a retro terminal-style multi-line text input
/// with character count display and themed styling.
///
/// ## Example Usage
/// ```swift
/// @State private var message = ""
///
/// CRTTextEditor("Enter your message...", text: $message)
///
/// CRTTextEditor("Body", text: $body, showCharacterCount: true, maxLength: 1000)
/// ```
public struct CRTTextEditor: View {
    @Environment(\.crtTheme) private var theme
    @FocusState private var isFocused: Bool

    private let placeholder: String
    @Binding private var text: String
    private let showCharacterCount: Bool
    private let maxLength: Int?
    private let minHeight: CGFloat

    /// Creates a CRT-styled multi-line text editor.
    /// - Parameters:
    ///   - placeholder: Placeholder text when empty
    ///   - text: Binding to the text value
    ///   - showCharacterCount: Whether to show character count (default: `false`)
    ///   - maxLength: Optional maximum character limit
    ///   - minHeight: Minimum height of the editor (default: `120`)
    public init(
        _ placeholder: String,
        text: Binding<String>,
        showCharacterCount: Bool = false,
        maxLength: Int? = nil,
        minHeight: CGFloat = 120
    ) {
        self.placeholder = placeholder
        self._text = text
        self.showCharacterCount = showCharacterCount
        self.maxLength = maxLength
        self.minHeight = minHeight
    }

    public var body: some View {
        VStack(alignment: .trailing, spacing: CRTTheme.Spacing.xxs) {
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(placeholder.uppercased())
                        .font(CRTTheme.Typography.font(size: 14))
                        .foregroundColor(theme.dim.opacity(0.6))
                        .padding(.horizontal, CRTTheme.Spacing.xs)
                        .padding(.vertical, CRTTheme.Spacing.xs)
                }

                TextEditor(text: $text)
                    .font(CRTTheme.Typography.font(size: 14))
                    .foregroundColor(theme.primary)
                    .tint(theme.primary)
                    .focused($isFocused)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, CRTTheme.Spacing.xxs)
                    .onChange(of: text) { _, newValue in
                        if let maxLength = maxLength, newValue.count > maxLength {
                            text = String(newValue.prefix(maxLength))
                        }
                    }
                    .keyboardDismissToolbar()
            }
            .frame(minHeight: minHeight)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(CRTTheme.Background.elevated.opacity(isFocused ? 0.8 : 0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .stroke(borderColor, lineWidth: isFocused ? 2 : 1)
            )
            .crtGlow(
                color: theme.primary,
                radius: isFocused ? 6 : 0,
                intensity: isFocused ? 0.3 : 0
            )

            if showCharacterCount {
                characterCountView
            }
        }
        .animation(.easeInOut(duration: CRTTheme.Animation.fast), value: isFocused)
        .accessibilityLabel(placeholder)
        .accessibilityValue(text.isEmpty ? "Empty" : "\(text.count) characters")
    }

    private var borderColor: Color {
        isFocused ? theme.primary : theme.dim.opacity(0.5)
    }

    @ViewBuilder
    private var characterCountView: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            if let maxLength = maxLength {
                let isNearLimit = text.count > Int(Double(maxLength) * 0.9)
                CRTText(
                    "\(text.count)/\(maxLength)",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: isNearLimit ? CRTTheme.State.warning : theme.dim
                )
            } else {
                CRTText(
                    "\(text.count) CHARS",
                    style: .caption,
                    glowIntensity: .subtle,
                    color: theme.dim
                )
            }
        }
    }
}

// MARK: - Preview

#Preview("CRTTextField") {
    struct PreviewWrapper: View {
        @State private var text1 = ""
        @State private var text2 = "Prefilled text"
        @State private var text3 = ""

        var body: some View {
            VStack(spacing: 16) {
                CRTTextField("Enter subject", text: $text1)

                CRTTextField("Search", text: $text2, icon: "magnifyingglass")

                CRTTextField("Recipient", text: $text3, icon: "person")
                    .disabled(true)
            }
            .padding()
            .background(CRTTheme.Background.screen)
        }
    }

    return PreviewWrapper()
}

#Preview("CRTTextEditor") {
    struct PreviewWrapper: View {
        @State private var text1 = ""
        @State private var text2 = "This is some existing content that was already entered into the text editor."

        var body: some View {
            VStack(spacing: 16) {
                CRTTextEditor("Enter your message...", text: $text1)

                CRTTextEditor(
                    "Message body",
                    text: $text2,
                    showCharacterCount: true,
                    maxLength: 500
                )
            }
            .padding()
            .background(CRTTheme.Background.screen)
        }
    }

    return PreviewWrapper()
}
