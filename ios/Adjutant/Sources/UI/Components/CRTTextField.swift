import SwiftUI
import Combine

// MARK: - Global Keyboard Dismiss Overlay

/// Tracks keyboard visibility and height via UIKit notifications.
/// Used by `KeyboardDismissOverlay` to position the floating dismiss button.
final class KeyboardObserver: ObservableObject {
    @Published var keyboardHeight: CGFloat = 0
    @Published var isVisible: Bool = false
    private var cancellables = Set<AnyCancellable>()

    init() {
        NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)
            .compactMap { ($0.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect)?.height }
            .sink { [weak self] height in
                self?.keyboardHeight = height
                self?.isVisible = true
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)
            .sink { [weak self] _ in
                self?.keyboardHeight = 0
                self?.isVisible = false
            }
            .store(in: &cancellables)
    }
}

/// A floating chevron button that appears above the keyboard for dismissal.
/// Apply this ONCE at the app's root view (e.g., ContentView). It works regardless
/// of NavigationStack/TabView context, bypassing SwiftUI's broken `.toolbar(placement: .keyboard)`.
struct KeyboardDismissOverlay: ViewModifier {
    @Environment(\.crtTheme) private var theme
    @StateObject private var keyboard = KeyboardObserver()

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottomTrailing) {
                if keyboard.isVisible {
                    Button {
                        UIApplication.shared.sendAction(
                            #selector(UIResponder.resignFirstResponder),
                            to: nil, from: nil, for: nil
                        )
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(theme.primary)
                            .padding(8)
                            .background(
                                Circle()
                                    .fill(theme.background.panel)
                                    .overlay(
                                        Circle()
                                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                                    )
                            )
                            .crtGlow(color: theme.primary, radius: 4, intensity: 0.3)
                    }
                    .padding(.trailing, 12)
                    .padding(.bottom, keyboard.keyboardHeight + 8)
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
                    .animation(.easeOut(duration: 0.15), value: keyboard.isVisible)
                }
            }
            .animation(.easeOut(duration: 0.15), value: keyboard.isVisible)
    }
}

extension View {
    /// Adds a global floating keyboard dismiss button. Apply once at the app root.
    func keyboardDismissOverlay() -> some View {
        modifier(KeyboardDismissOverlay())
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
                .font(CRTTheme.Typography.font(size: 14, theme: theme))
                .foregroundColor(theme.textPrimary)
                .tint(theme.accent)
                .focused($isFocused)
                .onSubmit {
                    onSubmit?()
                }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.background.elevated.opacity(isFocused ? 0.8 : 0.5))
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
                        .font(CRTTheme.Typography.font(size: 14, theme: theme))
                        .foregroundColor(theme.dim.opacity(0.6))
                        .padding(.horizontal, CRTTheme.Spacing.xs)
                        .padding(.vertical, CRTTheme.Spacing.xs)
                }

                TextEditor(text: $text)
                    .font(CRTTheme.Typography.font(size: 14, theme: theme))
                    .foregroundColor(theme.textPrimary)
                    .tint(theme.accent)
                    .focused($isFocused)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, CRTTheme.Spacing.xxs)
                    .onChange(of: text) { _, newValue in
                        if let maxLength = maxLength, newValue.count > maxLength {
                            text = String(newValue.prefix(maxLength))
                        }
                    }
                }
            .frame(minHeight: minHeight)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                    .fill(theme.background.elevated.opacity(isFocused ? 0.8 : 0.5))
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
            .background(CRTTheme.ColorTheme.pipboy.background.screen)
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
            .background(CRTTheme.ColorTheme.pipboy.background.screen)
        }
    }

    return PreviewWrapper()
}
