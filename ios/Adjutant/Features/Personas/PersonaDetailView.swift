import SwiftUI
import AdjutantKit

/// Detail view for a persona showing full trait breakdown, radar chart, and prompt preview.
/// Displays trait values as read-only stepped bars grouped by category, with a scrollable
/// prompt preview section and action buttons for edit and deploy.
struct PersonaDetailView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let persona: Persona

    @State private var promptText: String?
    @State private var isLoadingPrompt = false
    @State private var showingEditor = false
    @State private var showingDeploySheet = false

    private let apiClient = AppState.shared.apiClient

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.lg) {
                    // Header with radar chart
                    headerSection

                    // Trait breakdown by category
                    ForEach(TraitCategory.allCases) { category in
                        traitCategoryBreakdown(category)
                    }

                    // Prompt preview
                    promptSection

                    // Action buttons
                    actionButtons
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
            }
            .background(theme.background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText(persona.name.uppercased(), style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        CRTText("CLOSE", style: .caption, color: theme.dim)
                    }
                }
            }
        }
        .task {
            await loadPrompt()
        }
        .sheet(isPresented: $showingEditor) {
            PersonaEditorView(persona: persona, onSaved: { dismiss() })
        }
        .sheet(isPresented: $showingDeploySheet) {
            DeployPersonaSheet(persona: persona, onDeployed: { dismiss() })
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack(spacing: CRTTheme.Spacing.md) {
            TraitRadarChart(traits: persona.traits, size: 100)

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Text("\u{25C7}")
                        .font(CRTTheme.Typography.font(size: 18, weight: .bold))
                        .foregroundColor(theme.primary)
                    Text(persona.name.uppercased())
                        .font(CRTTheme.Typography.font(size: 20, weight: .bold))
                        .tracking(CRTTheme.Typography.wideLetterSpacing)
                        .foregroundColor(theme.primary)
                }

                if !persona.description.isEmpty {
                    Text(persona.description)
                        .font(CRTTheme.Typography.font(size: 14))
                        .foregroundColor(theme.dim)
                }

                HStack(spacing: CRTTheme.Spacing.xs) {
                    Text("\(persona.traits.totalPoints)/\(TraitValues.pointBudget) PTS")
                        .font(CRTTheme.Typography.font(size: 12, weight: .bold))
                        .foregroundColor(theme.primary)

                    if persona.traits.isWithinBudget {
                        BadgeView("VALID", style: .status(.success))
                    } else {
                        BadgeView("OVER BUDGET", style: .status(.error))
                    }
                }
            }

            Spacer()
        }
        .padding(CRTTheme.Spacing.sm)
        .background(theme.background.panel.opacity(0.3))
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
        )
        .cornerRadius(CRTTheme.CornerRadius.sm)
    }

    // MARK: - Trait Breakdown

    private func traitCategoryBreakdown(_ category: TraitCategory) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack {
                CRTText(category.rawValue, style: .caption, glowIntensity: .subtle, color: theme.primary)

                Rectangle()
                    .fill(theme.dim.opacity(0.3))
                    .frame(height: 1)

                Text("\(persona.traits.categoryTotal(for: category))")
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .foregroundColor(theme.dim)
                Text("PTS")
                    .font(CRTTheme.Typography.font(size: 8, weight: .medium))
                    .foregroundColor(theme.dim.opacity(0.6))
            }

            ForEach(category.traits, id: \.self) { trait in
                let info = traitDisplayInfo[trait]
                let value = persona.traits.value(for: trait)

                HStack(spacing: CRTTheme.Spacing.xs) {
                    Text(info?.label ?? trait.rawValue.uppercased())
                        .font(CRTTheme.Typography.font(size: 11, weight: .medium))
                        .tracking(0.5)
                        .foregroundColor(theme.dim)
                        .frame(width: 110, alignment: .leading)

                    // Read-only stepped display
                    HStack(spacing: 1) {
                        ForEach(0..<TraitValues.traitMax, id: \.self) { index in
                            Rectangle()
                                .fill(index < value ? theme.primary : theme.dim.opacity(0.15))
                                .overlay(
                                    Rectangle()
                                        .stroke(
                                            index < value ? theme.primary.opacity(0.5) : theme.dim.opacity(0.2),
                                            lineWidth: 0.5
                                        )
                                )
                        }
                    }
                    .frame(height: 12)
                    .cornerRadius(1)

                    Text(String(format: "%02d/%d", value, TraitValues.traitMax))
                        .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                        .foregroundColor(value > 0 ? theme.primary : theme.dim.opacity(0.4))
                        .frame(width: 40, alignment: .trailing)
                }
            }
        }
    }

    // MARK: - Prompt Section

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack {
                CRTText("PROMPT PREVIEW", style: .caption, glowIntensity: .subtle, color: theme.primary)

                Rectangle()
                    .fill(theme.dim.opacity(0.3))
                    .frame(height: 1)

                if isLoadingPrompt {
                    LoadingIndicator(size: .small)
                }
            }

            if let promptText {
                Text(promptText)
                    .font(CRTTheme.Typography.font(size: 12))
                    .foregroundColor(theme.primary.opacity(0.8))
                    .lineSpacing(4)
                    .padding(CRTTheme.Spacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.background.panel)
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .stroke(theme.dim.opacity(0.2), lineWidth: 1)
                    )
                    .cornerRadius(CRTTheme.CornerRadius.sm)
            } else if !isLoadingPrompt {
                Text("Failed to load prompt preview.")
                    .font(CRTTheme.Typography.font(size: 12))
                    .foregroundColor(theme.dim.opacity(0.5))
            }
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            CRTButton("EDIT", variant: .secondary, size: .medium) {
                showingEditor = true
            }
            .frame(maxWidth: .infinity)

            CRTButton("DEPLOY", variant: .primary, size: .medium) {
                showingDeploySheet = true
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Data Loading

    private func loadPrompt() async {
        isLoadingPrompt = true
        do {
            let response = try await apiClient.getPersonaPrompt(id: persona.id)
            promptText = response.prompt
        } catch {
            print("[PersonaDetailView] Prompt fetch failed: \(error.localizedDescription)")
        }
        isLoadingPrompt = false
    }
}

// MARK: - Preview

#Preview("PersonaDetailView") {
    let persona = Persona(
        id: "1", name: "Sentinel",
        description: "QA specialist with deep testing focus and emphasis on correctness",
        traits: TraitValues(
            architectureFocus: 4, qaScalability: 6,
            qaCorrectness: 18, testingUnit: 16,
            testingAcceptance: 14, codeReview: 10
        ),
        createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z"
    )

    PersonaDetailView(persona: persona)
}
