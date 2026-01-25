import SwiftUI

/// Available CRT color themes based on vintage phosphor displays
public enum CRTTheme: String, CaseIterable, Identifiable {
    case green = "green"
    case red = "red"
    case blue = "blue"
    case tan = "tan"
    case pink = "pink"
    case purple = "purple"

    public var id: String { rawValue }

    /// Display name for the theme
    public var displayName: String {
        switch self {
        case .green: return "GAS-BOY"
        case .red: return "BLOOD-BAG"
        case .blue: return "VAULT-TEC"
        case .tan: return "WASTELAND"
        case .pink: return "PINK-MIST"
        case .purple: return "RAD-STORM"
        }
    }

    /// Primary phosphor color
    public var primary: Color {
        switch self {
        case .green: return Color(hex: 0x20C20E)
        case .red: return Color(hex: 0xFF3333)
        case .blue: return Color(hex: 0x00AAFF)
        case .tan: return Color(hex: 0xD2B48C)
        case .pink: return Color(hex: 0xFF69B4)
        case .purple: return Color(hex: 0xBF94FF)
        }
    }

    /// Bright/highlighted phosphor color
    public var bright: Color {
        switch self {
        case .green: return Color(hex: 0x33FF33)
        case .red: return Color(hex: 0xFF6666)
        case .blue: return Color(hex: 0x33CCFF)
        case .tan: return Color(hex: 0xF5DEB3)
        case .pink: return Color(hex: 0xFFB6C1)
        case .purple: return Color(hex: 0xDABFFF)
        }
    }

    /// Dim/muted phosphor color
    public var dim: Color {
        switch self {
        case .green: return Color(hex: 0x0A5F07)
        case .red: return Color(hex: 0x880000)
        case .blue: return Color(hex: 0x004488)
        case .tan: return Color(hex: 0x8B4513)
        case .pink: return Color(hex: 0xC71585)
        case .purple: return Color(hex: 0x6A0DAD)
        }
    }

    /// Glow color with alpha for shadow effects
    public var glow: Color {
        primary.opacity(0.6)
    }

    /// Bloom color for outer glow effects
    public var bloom: Color {
        primary.opacity(0.2)
    }

    /// RGB components for Core Graphics operations
    public var primaryRGB: (red: CGFloat, green: CGFloat, blue: CGFloat) {
        switch self {
        case .green: return (32/255, 194/255, 14/255)
        case .red: return (255/255, 51/255, 51/255)
        case .blue: return (0/255, 170/255, 255/255)
        case .tan: return (210/255, 180/255, 140/255)
        case .pink: return (255/255, 105/255, 180/255)
        case .purple: return (191/255, 148/255, 255/255)
        }
    }
}

// MARK: - Shared Background Colors

extension CRTTheme {
    /// Main screen background - deep CRT black
    public static let screenBackground = Color(hex: 0x0A0A0A)

    /// Panel/card background
    public static let panelBackground = Color(hex: 0x050505)

    /// Bezel color
    public static let bezel = Color(hex: 0x1A1A18)

    /// Bezel highlight
    public static let bezelHighlight = Color(hex: 0x2A2A26)

    /// Bezel shadow
    public static let bezelShadow = Color(hex: 0x0A0A08)

    /// Error/danger color
    public static let error = Color(hex: 0xFF4444)

    /// Warning/amber color
    public static let amber = Color(hex: 0xFFB000)

    /// Offline/disabled color
    public static let offline = Color(hex: 0x666666)
}

// MARK: - Status Colors

extension CRTTheme {
    /// Status indicator colors
    public enum StatusColor {
        case working
        case idle
        case blocked
        case stuck
        case offline

        public func color(for theme: CRTTheme) -> Color {
            switch self {
            case .working: return theme.bright
            case .idle: return theme.primary
            case .blocked: return CRTTheme.amber
            case .stuck: return CRTTheme.error
            case .offline: return CRTTheme.offline
            }
        }
    }

    /// Priority badge colors
    public enum PriorityColor {
        case p0 // Urgent
        case p1 // High
        case p2 // Normal
        case p3 // Low
        case p4 // Lowest

        public func color(for theme: CRTTheme) -> Color {
            switch self {
            case .p0: return CRTTheme.error
            case .p1: return CRTTheme.amber
            case .p2: return theme.primary
            case .p3: return theme.dim
            case .p4: return CRTTheme.offline
            }
        }
    }
}

// MARK: - Color Hex Extension

extension Color {
    /// Initialize Color from hex value
    init(hex: UInt32, alpha: Double = 1.0) {
        let red = Double((hex >> 16) & 0xFF) / 255.0
        let green = Double((hex >> 8) & 0xFF) / 255.0
        let blue = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}
