import SwiftUI

/// A prominent amber banner displayed when auto-develop is paused awaiting a vision update.
///
/// Shows a warning icon, explanation text, and a text editor for the user to provide
/// updated vision context. Submitting resumes the auto-develop loop.
struct EscalationBannerView: View {
    @Environment(\.crtTheme) private var theme
    @State private var visionText: String = ""
    @State private var isSubmitting = false

    /// Callback invoked when the user submits their vision context.
    let onSubmitVision: (String) -> Void

    /// Amber color used for warning styling.
    private var amber: Color { Color.orange }

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            // Header
            HStack(spacing: CRTTheme.Spacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(amber)
                CRTText("VISION UPDATE NEEDED", style: .subheader, glowIntensity: .medium, color: amber)
            }

            // Explanation
            CRTText(
                "Auto-develop has paused because it encountered a decision that requires your input. Provide updated vision context to resume the development loop.",
                style: .caption,
                glowIntensity: .subtle,
                color: theme.dim
            )

            // Text editor for vision input
            TextEditor(text: $visionText)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(theme.primary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 80, maxHeight: 120)
                .padding(CRTTheme.Spacing.xs)
                .background(theme.background.screen.opacity(0.8))
                .cornerRadius(CRTTheme.CornerRadius.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(amber.opacity(0.4), lineWidth: 1)
                )

            // Submit button
            Button {
                guard !visionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                isSubmitting = true
                onSubmitVision(visionText.trimmingCharacters(in: .whitespacesAndNewlines))
            } label: {
                HStack {
                    if isSubmitting {
                        LoadingIndicator(size: .small)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .foregroundColor(amber)
                    }
                    CRTText("RESUME WITH VISION UPDATE", style: .body, glowIntensity: .medium, color: amber)
                    Spacer()
                }
                .padding(.vertical, CRTTheme.Spacing.xs)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .background(amber.opacity(0.1))
                .cornerRadius(CRTTheme.CornerRadius.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(amber.opacity(0.4), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .disabled(visionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSubmitting)
        }
        .padding(CRTTheme.Spacing.sm)
        .background(amber.opacity(0.05))
        .cornerRadius(CRTTheme.CornerRadius.md)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(amber.opacity(0.3), lineWidth: 1)
        )
    }
}
