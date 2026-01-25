import SwiftUI

/// Manages the current CRT theme with persistent storage
@MainActor
public final class ThemeManager: ObservableObject {
    /// Shared singleton instance
    public static let shared = ThemeManager()

    /// Storage key for theme persistence
    private static let themeKey = "selectedCRTTheme"

    /// The currently selected theme
    @Published public var currentTheme: CRTTheme {
        didSet {
            UserDefaults.standard.set(currentTheme.rawValue, forKey: Self.themeKey)
        }
    }

    private init() {
        if let savedTheme = UserDefaults.standard.string(forKey: Self.themeKey),
           let theme = CRTTheme(rawValue: savedTheme) {
            self.currentTheme = theme
        } else {
            self.currentTheme = .green
        }
    }

    /// Cycle to the next theme
    public func nextTheme() {
        let themes = CRTTheme.allCases
        guard let currentIndex = themes.firstIndex(of: currentTheme) else { return }
        let nextIndex = (currentIndex + 1) % themes.count
        currentTheme = themes[nextIndex]
    }

    /// Cycle to the previous theme
    public func previousTheme() {
        let themes = CRTTheme.allCases
        guard let currentIndex = themes.firstIndex(of: currentTheme) else { return }
        let previousIndex = (currentIndex - 1 + themes.count) % themes.count
        currentTheme = themes[previousIndex]
    }
}

// MARK: - Environment Key

private struct ThemeEnvironmentKey: EnvironmentKey {
    static let defaultValue: CRTTheme = .green
}

extension EnvironmentValues {
    /// The current CRT theme
    public var crtTheme: CRTTheme {
        get { self[ThemeEnvironmentKey.self] }
        set { self[ThemeEnvironmentKey.self] = newValue }
    }
}

// MARK: - View Modifiers

extension View {
    /// Apply the current theme from ThemeManager to the view hierarchy
    public func withThemeManager(_ themeManager: ThemeManager) -> some View {
        self.environment(\.crtTheme, themeManager.currentTheme)
    }

    /// Apply a specific theme to the view hierarchy
    public func withCRTTheme(_ theme: CRTTheme) -> some View {
        self.environment(\.crtTheme, theme)
    }
}

// MARK: - AppStorage Property Wrapper Alternative

/// Property wrapper for theme selection with AppStorage
@propertyWrapper
public struct ThemeStorage: DynamicProperty {
    @AppStorage("selectedCRTTheme") private var themeRawValue: String = CRTTheme.green.rawValue

    public init() {}

    public var wrappedValue: CRTTheme {
        get {
            CRTTheme(rawValue: themeRawValue) ?? .green
        }
        nonmutating set {
            themeRawValue = newValue.rawValue
        }
    }

    public var projectedValue: Binding<CRTTheme> {
        Binding(
            get: { self.wrappedValue },
            set: { self.wrappedValue = $0 }
        )
    }
}
