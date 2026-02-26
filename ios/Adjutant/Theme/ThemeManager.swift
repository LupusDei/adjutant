import SwiftUI

/// Manages the current CRT theme with persistent storage
@MainActor
public final class ThemeManager: ObservableObject {
    /// Shared singleton instance
    public static let shared = ThemeManager()

    /// Storage key for theme persistence
    private static let themeKey = "selectedCRTTheme"

    /// The currently selected theme
    @Published public var currentTheme: CRTTheme.ColorTheme {
        didSet {
            UserDefaults.standard.set(currentTheme.rawValue, forKey: Self.themeKey)
        }
    }

    private init() {
        if let savedTheme = UserDefaults.standard.string(forKey: Self.themeKey),
           let theme = CRTTheme.ColorTheme(rawValue: savedTheme) {
            self.currentTheme = theme
        } else {
            // Legacy values (green, red, blue, tan, pink, purple) won't match — fall back to pipboy
            self.currentTheme = .pipboy
        }
    }

    /// Cycle to the next theme
    public func nextTheme() {
        let themes = CRTTheme.ColorTheme.allCases
        guard let currentIndex = themes.firstIndex(of: currentTheme) else { return }
        let nextIndex = (currentIndex + 1) % themes.count
        currentTheme = themes[nextIndex]
    }

    /// Cycle to the previous theme
    public func previousTheme() {
        let themes = CRTTheme.ColorTheme.allCases
        guard let currentIndex = themes.firstIndex(of: currentTheme) else { return }
        let previousIndex = (currentIndex - 1 + themes.count) % themes.count
        currentTheme = themes[previousIndex]
    }
}

// MARK: - View Modifiers

extension View {
    /// Apply the current theme from ThemeManager to the view hierarchy
    @MainActor
    public func withThemeManager(_ themeManager: ThemeManager) -> some View {
        self.environment(\.crtTheme, themeManager.currentTheme)
    }

    /// Apply a specific color theme to the view hierarchy
    public func withColorTheme(_ theme: CRTTheme.ColorTheme) -> some View {
        self.environment(\.crtTheme, theme)
    }
}

// MARK: - AppStorage Property Wrapper Alternative

/// Property wrapper for theme selection with AppStorage
@propertyWrapper
public struct ThemeStorage: DynamicProperty {
    @AppStorage("selectedCRTTheme") private var themeRawValue: String = CRTTheme.ColorTheme.pipboy.rawValue

    public init() {}

    public var wrappedValue: CRTTheme.ColorTheme {
        get {
            CRTTheme.ColorTheme(rawValue: themeRawValue) ?? .pipboy
        }
        nonmutating set {
            themeRawValue = newValue.rawValue
        }
    }

    public var projectedValue: Binding<CRTTheme.ColorTheme> {
        Binding(
            get: { self.wrappedValue },
            set: { self.wrappedValue = $0 }
        )
    }
}
