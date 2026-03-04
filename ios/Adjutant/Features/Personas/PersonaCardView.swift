import SwiftUI
import AdjutantKit

/// A standby persona card for the spawnable roster.
/// Features a dashed border, diamond icon, description, mini radar chart, and DEPLOY button.
struct PersonaCardView: View {
    @Environment(\.crtTheme) private var theme

    let persona: Persona
    let onDeploy: () -> Void
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                // Top row: diamond icon + name + DEPLOY button
                HStack(alignment: .top, spacing: CRTTheme.Spacing.xs) {
                    // Diamond icon prefix
                    Text("\u{25C7}")
                        .font(CRTTheme.Typography.font(size: 14, weight: .bold))
                        .foregroundColor(theme.primary)

                    VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxxs) {
                        Text(persona.name.uppercased())
                            .font(CRTTheme.Typography.font(size: 14, weight: .bold))
                            .tracking(CRTTheme.Typography.letterSpacing)
                            .foregroundColor(theme.primary)
                            .lineLimit(1)

                        if !persona.description.isEmpty {
                            Text(persona.description)
                                .font(CRTTheme.Typography.font(size: 11))
                                .foregroundColor(theme.dim)
                                .lineLimit(2)
                        }
                    }

                    Spacer()

                    // DEPLOY button
                    Button(action: onDeploy) {
                        Text("DEPLOY")
                            .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                            .tracking(CRTTheme.Typography.letterSpacing)
                            .foregroundColor(theme.primary)
                            .padding(.horizontal, CRTTheme.Spacing.xs)
                            .padding(.vertical, CRTTheme.Spacing.xxs)
                            .background(
                                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                                    .fill(theme.primary.opacity(0.12))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                                    .stroke(theme.primary.opacity(0.5), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }

                // Radar chart
                HStack {
                    Spacer()
                    TraitRadarChart(traits: persona.traits, size: 70)
                    Spacer()
                }

                // Budget indicator
                HStack(spacing: CRTTheme.Spacing.xxs) {
                    Text("BUDGET")
                        .font(CRTTheme.Typography.font(size: 8, weight: .medium))
                        .tracking(0.5)
                        .foregroundColor(theme.dim)

                    Text("\(persona.traits.totalPoints)/\(TraitValues.pointBudget)")
                        .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                        .foregroundColor(theme.primary)

                    Text("PTS")
                        .font(CRTTheme.Typography.font(size: 8, weight: .medium))
                        .tracking(0.5)
                        .foregroundColor(theme.dim)
                }
            }
            .padding(CRTTheme.Spacing.sm)
            .background(theme.background.panel.opacity(0.3))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(
                        theme.primary.opacity(0.3),
                        style: StrokeStyle(lineWidth: 1, dash: [6, 3])
                    )
            )
            .cornerRadius(CRTTheme.CornerRadius.md)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Persona \(persona.name)")
        .accessibilityHint("Tap for details, or use Deploy button to spawn")
    }
}

// MARK: - Preview

#Preview("PersonaCardView") {
    let sentinel = Persona(
        id: "1",
        name: "Sentinel",
        description: "QA specialist with deep testing focus",
        traits: TraitValues(
            qaScalability: 6, qaCorrectness: 18,
            testingUnit: 16, testingAcceptance: 14,
            codeReview: 10
        ),
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z"
    )

    let architect = Persona(
        id: "2",
        name: "Architect",
        description: "System design specialist",
        traits: TraitValues(
            architectureFocus: 18, modularArchitecture: 16,
            technicalDepth: 14
        ),
        createdAt: "2026-03-01T00:00:00Z",
        updatedAt: "2026-03-01T00:00:00Z"
    )

    ScrollView {
        VStack(spacing: 12) {
            PersonaCardView(persona: sentinel, onDeploy: {}, onTap: {})
            PersonaCardView(persona: architect, onDeploy: {}, onTap: {})
        }
        .padding()
    }
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
