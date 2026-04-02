import SwiftUI
import AdjutantKit

/// Sheet displaying full persona trait breakdown with horizontal bars.
/// Presented on long-press of an agent row in the overview.
struct PersonaDetailSheet: View {
    let agentName: String
    let personaId: String

    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var persona: Persona?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                theme.background.screen.ignoresSafeArea()

                if isLoading {
                    loadingView
                } else if let persona {
                    personaContent(persona)
                } else if let errorMessage {
                    errorView(errorMessage)
                }
            }
            .navigationTitle(agentName.uppercased())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(theme.primary)
                }
            }
        }
        .task {
            await loadPersona()
        }
    }

    // MARK: - Content

    private func personaContent(_ persona: Persona) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.lg) {
                // Header: name + source badge
                headerSection(persona)

                // Description
                if !persona.description.isEmpty {
                    descriptionSection(persona.description)
                }

                // Trait bars grouped by category
                ForEach(TraitCategory.allCases) { category in
                    traitCategorySection(category, traits: persona.traits)
                }

                // Budget summary
                budgetSummary(persona.traits)
            }
            .padding(CRTTheme.Spacing.md)
        }
    }

    // MARK: - Header

    private func headerSection(_ persona: Persona) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                CRTText(persona.name.uppercased(), style: .title, glowIntensity: .medium)

                CRTText(
                    "SELF-GENERATED",
                    style: .caption,
                    color: theme.primary
                )
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .overlay(
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                )
            }
        }
    }

    // MARK: - Description

    private func descriptionSection(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            CRTText("IDENTITY", style: .caption, glowIntensity: .subtle, color: theme.dim)
            CRTText(text, style: .body, color: theme.primary.opacity(0.8))
        }
        .padding(CRTTheme.Spacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .fill(theme.dim.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.dim.opacity(0.15), lineWidth: 1)
        )
    }

    // MARK: - Trait Category

    private func traitCategorySection(_ category: TraitCategory, traits: TraitValues) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText(category.rawValue, style: .caption, glowIntensity: .subtle, color: theme.dim)

            ForEach(category.traits, id: \.self) { trait in
                traitBar(trait, value: traits.value(for: trait))
            }
        }
    }

    // MARK: - Trait Bar

    private func traitBar(_ trait: PersonaTrait, value: Int) -> some View {
        let info = traitDisplayInfo[trait]
        let fraction = Double(value) / Double(TraitValues.traitMax)
        let barColor = barColorForValue(value)

        return HStack(spacing: CRTTheme.Spacing.sm) {
            // Label
            CRTText(
                info?.label ?? trait.snakeCaseValue.uppercased(),
                style: .caption,
                color: theme.dim
            )
            .frame(width: 110, alignment: .trailing)

            // Bar track
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track background
                    RoundedRectangle(cornerRadius: 2)
                        .fill(theme.dim.opacity(0.1))

                    // Filled bar
                    RoundedRectangle(cornerRadius: 2)
                        .fill(barColor)
                        .frame(width: max(0, geo.size.width * fraction))
                        .shadow(color: barColor.opacity(0.5), radius: 3)
                }
            }
            .frame(height: 10)

            // Value
            CRTText(
                "\(value)",
                style: .caption,
                glowIntensity: value >= 15 ? .medium : .subtle,
                color: barColor
            )
            .frame(width: 24, alignment: .trailing)
        }
        .frame(height: 18)
    }

    // MARK: - Budget Summary

    private func budgetSummary(_ traits: TraitValues) -> some View {
        HStack {
            Spacer()
            CRTText(
                "TOTAL: \(traits.totalPoints)/\(TraitValues.pointBudget)",
                style: .caption,
                glowIntensity: .subtle,
                color: theme.dim
            )
        }
        .padding(.top, CRTTheme.Spacing.sm)
    }

    // MARK: - Loading / Error

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            ProgressView()
                .tint(theme.primary)
            CRTText("LOADING PERSONA...", style: .caption, color: theme.dim)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "person.crop.circle.badge.questionmark")
                .font(.system(size: 40))
                .foregroundColor(theme.dim)
            CRTText("NO PERSONA", style: .body, color: theme.dim)
            CRTText(message, style: .caption, color: theme.dim.opacity(0.6))
        }
    }

    // MARK: - Helpers

    private func barColorForValue(_ value: Int) -> Color {
        if value >= 15 { return theme.primary }
        if value >= 8 { return theme.primary.opacity(0.7) }
        if value >= 1 { return theme.dim }
        return theme.dim.opacity(0.3)
    }

    private func loadPersona() async {
        do {
            let result = try await AppState.shared.apiClient.getPersona(id: personaId)
            persona = result
            isLoading = false
        } catch {
            errorMessage = "Could not load persona"
            isLoading = false
        }
    }
}
