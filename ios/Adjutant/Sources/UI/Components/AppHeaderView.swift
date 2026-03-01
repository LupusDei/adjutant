import SwiftUI

/// Shared app header component containing title and optional loading indicator.
/// Used across main views for consistent navigation styling.
struct AppHeaderView: View {
    @Environment(\.crtTheme) private var theme

    /// Title displayed in the header
    let title: String

    /// Subtitle displayed below the title
    let subtitle: String?

    /// Whether to show a loading indicator
    var isLoading: Bool = false

    init(
        title: String,
        subtitle: String? = nil,
        isLoading: Bool = false
    ) {
        self.title = title
        self.subtitle = subtitle
        self.isLoading = isLoading
    }

    var body: some View {
        HStack(alignment: .center, spacing: CRTTheme.Spacing.md) {
            // Title section
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                CRTText(title, style: .header)
                if let subtitle = subtitle {
                    CRTText(subtitle, style: .caption, color: theme.dim)
                }
            }

            Spacer()

            // Loading indicator
            if isLoading {
                InlineLoadingIndicator()
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
    }
}

// MARK: - Preview

#Preview("App Header") {
    VStack {
        AppHeaderView(
            title: "ADJUTANT",
            subtitle: "SYSTEM OVERVIEW"
        )
        Spacer()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
    .preferredColorScheme(.dark)
}

#Preview("App Header - Loading") {
    VStack {
        AppHeaderView(
            title: "BEADS",
            subtitle: nil,
            isLoading: true
        )
        Spacer()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
    .preferredColorScheme(.dark)
}
