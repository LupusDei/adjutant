import SwiftUI
import AdjutantKit

/// A dropdown menu for filtering beads by project source.
/// Shows "All" option plus available project directories that contain beads.
struct SourceFilterDropdown: View {
    @Environment(\.crtTheme) private var theme

    /// Available bead sources from the API
    let sources: [BeadSource]

    /// Currently selected source (nil = all)
    @Binding var selectedSource: String?

    var body: some View {
        Menu {
            // ALL option
            Button {
                withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                    selectedSource = nil
                }
            } label: {
                HStack {
                    Text("ALL")
                    if selectedSource == nil {
                        Image(systemName: "checkmark")
                    }
                }
            }

            if !sources.isEmpty {
                Divider()

                // Individual project source options
                ForEach(sources) { source in
                    Button {
                        withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                            selectedSource = source.name
                        }
                    } label: {
                        HStack {
                            Text(source.name.uppercased())
                            if selectedSource == source.name {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
        } label: {
            dropdownButton
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Project filter")
        .accessibilityValue(displayText)
    }

    private var dropdownButton: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "folder")
                .font(.system(size: 14))
                .foregroundColor(theme.primary)

            Text(displayText)
                .font(CRTTheme.Typography.font(size: 12, weight: .medium))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(theme.primary)
                .lineLimit(1)

            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(theme.primary.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }

    private var displayText: String {
        guard let selected = selectedSource else {
            return "ALL"
        }
        return selected.uppercased()
    }
}

// MARK: - Preview

#Preview("Source Filter Dropdown") {
    VStack(spacing: 20) {
        SourceFilterDropdown(
            sources: [
                BeadSource(name: "my-project", path: "/home/user/my-project", hasBeads: true),
                BeadSource(name: "another-app", path: "/home/user/another-app", hasBeads: true),
            ],
            selectedSource: .constant(nil)
        )

        SourceFilterDropdown(sources: [], selectedSource: .constant(nil))
    }
    .padding()
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
    .preferredColorScheme(.dark)
}
