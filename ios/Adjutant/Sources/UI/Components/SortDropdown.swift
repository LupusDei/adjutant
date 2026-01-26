import SwiftUI

/// A dropdown menu for sorting beads in the Kanban board.
/// Persists selection to UserDefaults via the view model.
struct SortDropdown: View {
    @Environment(\.crtTheme) private var theme
    @Binding var currentSort: BeadsListViewModel.BeadSort

    var body: some View {
        Menu {
            ForEach(BeadsListViewModel.BeadSort.allCases) { sort in
                Button {
                    withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                        currentSort = sort
                    }
                } label: {
                    HStack {
                        Label(sort.displayName, systemImage: sort.systemImage)
                        if currentSort == sort {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            dropdownButton
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel("Sort by")
        .accessibilityValue(currentSort.displayName)
    }

    private var dropdownButton: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 12))
                .foregroundColor(theme.primary)

            Text(currentSort.displayName)
                .font(CRTTheme.Typography.font(size: 11, weight: .medium))
                .tracking(CRTTheme.Typography.letterSpacing)
                .foregroundColor(theme.primary)
                .lineLimit(1)

            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xxs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.primary.opacity(0.1))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Preview

#Preview("Sort Dropdown") {
    VStack(spacing: 20) {
        SortDropdown(currentSort: .constant(.lastUpdated))
        SortDropdown(currentSort: .constant(.priority))
        SortDropdown(currentSort: .constant(.alphabetical))
    }
    .padding()
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
}
