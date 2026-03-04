import SwiftUI
import AdjutantKit

/// Section displaying personas as a spawnable roster on the Agents page.
/// Shows persona cards in a scrollable grid with a BUILD PERSONA button.
struct PersonaRosterSection: View {
    @Environment(\.crtTheme) private var theme

    let personas: [Persona]
    let onBuildPersona: () -> Void
    let onDeploy: (Persona) -> Void
    let onSelectPersona: (Persona) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            // Section header
            sectionHeader

            if personas.isEmpty {
                emptyState
            } else {
                personaGrid
            }
        }
    }

    // MARK: - Section Header

    private var sectionHeader: some View {
        HStack {
            CRTText("PERSONA ROSTER", style: .caption, glowIntensity: .subtle, color: theme.dim)

            Rectangle()
                .fill(theme.dim.opacity(0.3))
                .frame(height: 1)

            CRTText("\(personas.count)", style: .caption, glowIntensity: .subtle, color: theme.dim)

            // Build Persona button
            Button(action: onBuildPersona) {
                HStack(spacing: 4) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 12))
                    Text("BUILD")
                        .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                        .tracking(CRTTheme.Typography.letterSpacing)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.xs)
                .padding(.vertical, CRTTheme.Spacing.xxs)
                .background(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .fill(theme.primary.opacity(0.12))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
        .padding(.horizontal, CRTTheme.Spacing.md)
    }

    // MARK: - Persona Grid

    private var personaGrid: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                ForEach(personas) { persona in
                    PersonaCardView(
                        persona: persona,
                        onDeploy: { onDeploy(persona) },
                        onTap: { onSelectPersona(persona) }
                    )
                    .frame(width: 200)
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "person.badge.plus")
                .font(.system(size: 28))
                .foregroundColor(theme.dim)

            VStack(spacing: CRTTheme.Spacing.xxs) {
                CRTText("BUILD YOUR FIRST AGENT PERSONA", style: .caption, glowIntensity: .subtle, color: theme.dim)

                Text("Define specialized roles with custom trait distributions.\nBudget 100 points across 12 skills.")
                    .font(CRTTheme.Typography.font(size: 11))
                    .foregroundColor(theme.dim.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }

            Button(action: onBuildPersona) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 14))
                    Text("CREATE PERSONA")
                        .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                        .tracking(CRTTheme.Typography.letterSpacing)
                }
                .foregroundColor(theme.primary)
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.sm)
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
        .frame(maxWidth: .infinity)
        .padding(.vertical, CRTTheme.Spacing.lg)
        .padding(.horizontal, CRTTheme.Spacing.md)
    }
}

// MARK: - Preview

#Preview("PersonaRosterSection - With Personas") {
    let personas = [
        Persona(
            id: "1", name: "Sentinel", description: "QA specialist",
            traits: TraitValues(qaCorrectness: 18, testingUnit: 16, testingAcceptance: 14, codeReview: 10),
            createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z"
        ),
        Persona(
            id: "2", name: "Architect", description: "System design expert",
            traits: TraitValues(architectureFocus: 18, modularArchitecture: 16, technicalDepth: 14),
            createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z"
        ),
    ]

    PersonaRosterSection(
        personas: personas,
        onBuildPersona: {},
        onDeploy: { _ in },
        onSelectPersona: { _ in }
    )
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}

#Preview("PersonaRosterSection - Empty") {
    PersonaRosterSection(
        personas: [],
        onBuildPersona: {},
        onDeploy: { _ in },
        onSelectPersona: { _ in }
    )
    .background(CRTTheme.ColorTheme.pipboy.background.screen)
}
