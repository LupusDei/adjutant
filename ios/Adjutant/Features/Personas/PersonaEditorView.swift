#if canImport(UIKit)
import UIKit
#endif
import SwiftUI
import AdjutantKit

/// Editor view for creating and editing personas with stepped sliders and budget gauge.
/// Features segmented volume-meter sliders (20 segments per trait), a 10-segment budget
/// power gauge with green/amber/red zones, soft-cap enforcement, and trait grouping
/// into 4 cognitive categories (Engineering, Quality, Product, Craft).
struct PersonaEditorView: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    /// Existing persona to edit (nil for create mode)
    var persona: Persona?
    /// Callback when persona is saved
    let onSaved: () -> Void

    @State private var name: String = ""
    @State private var descriptionText: String = ""
    @State private var traits = TraitValues.empty
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiClient = AppState.shared.apiClient

    private var isEditMode: Bool { persona != nil }
    private var totalPoints: Int { traits.totalPoints }
    private var isOverBudget: Bool { totalPoints > TraitValues.pointBudget }
    private var canSave: Bool { !name.isEmpty && !isOverBudget && !isSaving }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: CRTTheme.Spacing.lg) {
                    // Budget gauge (sticky at top)
                    budgetGauge

                    // Name field
                    nameSection

                    // Description field
                    descriptionSection

                    // Trait sliders by category
                    ForEach(TraitCategory.allCases) { category in
                        traitCategorySection(category)
                    }

                    // Error message
                    if let errorMessage {
                        ErrorBanner(
                            message: errorMessage,
                            onRetry: nil,
                            onDismiss: { self.errorMessage = nil }
                        )
                    }

                    // Save button
                    CRTButton(
                        isEditMode ? "UPDATE PERSONA" : "SAVE PERSONA",
                        variant: .primary,
                        size: .large,
                        isLoading: isSaving
                    ) {
                        Task<Void, Never> { await save() }
                    }
                    .frame(maxWidth: .infinity)
                    .disabled(!canSave)
                }
                .padding(.horizontal, CRTTheme.Spacing.md)
                .padding(.vertical, CRTTheme.Spacing.md)
            }
            .background(theme.background.screen)
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText(isEditMode ? "EDIT PERSONA" : "BUILD PERSONA", style: .subheader, glowIntensity: .medium)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        CRTText("CANCEL", style: .caption, color: theme.dim)
                    }
                    .disabled(isSaving)
                }
            }
        }
        .onAppear {
            if let persona {
                name = persona.name
                descriptionText = persona.description
                traits = persona.traits
            }
        }
    }

    // MARK: - Budget Gauge

    private var budgetGauge: some View {
        VStack(spacing: CRTTheme.Spacing.xxs) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                Text("BUDGET")
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .tracking(CRTTheme.Typography.letterSpacing)
                    .foregroundColor(theme.dim)

                // Segmented gauge (10 segments)
                HStack(spacing: 2) {
                    ForEach(0..<10, id: \.self) { segment in
                        let segmentStart = segment * 10
                        let fillRatio = min(1.0, max(0.0, Double(totalPoints - segmentStart) / 10.0))
                        Rectangle()
                            .fill(gaugeColor(fillRatio: fillRatio, segmentIndex: segment))
                            .frame(height: 12)
                            .overlay(
                                Rectangle()
                                    .fill(Color.clear)
                                    .frame(width: nil)
                                    .overlay(
                                        GeometryReader { geo in
                                            Rectangle()
                                                .fill(gaugeSegmentColor)
                                                .frame(width: geo.size.width * fillRatio)
                                        }
                                    )
                            )
                            .overlay(
                                Rectangle()
                                    .stroke(theme.dim.opacity(0.3), lineWidth: 0.5)
                            )
                    }
                }
                .frame(maxWidth: .infinity)

                Text(String(format: "%03d/%d PTS", totalPoints, TraitValues.pointBudget))
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .foregroundColor(budgetTextColor)
            }

            // Over budget warning
            if isOverBudget {
                Text("REDUCE \(traits.overBudgetBy) POINTS TO SAVE")
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .tracking(0.5)
                    .foregroundColor(CRTTheme.State.error)
            } else if totalPoints >= 80 {
                Text(totalPoints == 100 ? "FULLY ALLOCATED" : "NEARING LIMIT")
                    .font(CRTTheme.Typography.font(size: 10, weight: .medium))
                    .tracking(0.5)
                    .foregroundColor(CRTTheme.State.warning)
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(theme.background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                .stroke(budgetBorderColor, lineWidth: 1)
        )
        .cornerRadius(CRTTheme.CornerRadius.sm)
    }

    private var gaugeSegmentColor: Color {
        if isOverBudget { return CRTTheme.State.error }
        if totalPoints >= 80 { return CRTTheme.State.warning }
        return theme.primary
    }

    private func gaugeColor(fillRatio: Double, segmentIndex: Int) -> Color {
        if fillRatio <= 0 { return theme.dim.opacity(0.1) }
        return gaugeSegmentColor.opacity(0.3)
    }

    private var budgetTextColor: Color {
        if isOverBudget { return CRTTheme.State.error }
        if totalPoints >= 80 { return CRTTheme.State.warning }
        return theme.primary
    }

    private var budgetBorderColor: Color {
        if isOverBudget { return CRTTheme.State.error.opacity(0.5) }
        if totalPoints >= 80 { return CRTTheme.State.warning.opacity(0.3) }
        return theme.primary.opacity(0.2)
    }

    // MARK: - Name Section

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            CRTText("NAME", style: .caption, glowIntensity: .subtle, color: theme.dim)

            TextField("", text: $name)
                .textFieldStyle(.plain)
                .font(CRTTheme.Typography.font(size: 16, weight: .bold))
                .foregroundColor(theme.primary)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .disableAutocorrection(true)
                .placeholder(when: name.isEmpty) {
                    Text("Enter persona name...")
                        .font(CRTTheme.Typography.font(size: 16))
                        .foregroundColor(theme.dim.opacity(0.4))
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .background(theme.background.elevated)
                .cornerRadius(CRTTheme.CornerRadius.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
        }
    }

    // MARK: - Description Section

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            CRTText("DESCRIPTION", style: .caption, glowIntensity: .subtle, color: theme.dim)

            TextField("", text: $descriptionText, axis: .vertical)
                .textFieldStyle(.plain)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .lineLimit(3...5)
                .placeholder(when: descriptionText.isEmpty) {
                    Text("Describe this persona's role...")
                        .font(CRTTheme.Typography.font(size: 14))
                        .foregroundColor(theme.dim.opacity(0.4))
                }
                .padding(.vertical, CRTTheme.Spacing.sm)
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .background(theme.background.elevated)
                .cornerRadius(CRTTheme.CornerRadius.sm)
                .overlay(
                    RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                        .stroke(theme.primary.opacity(0.3), lineWidth: 1)
                )
        }
    }

    // MARK: - Trait Category Section

    private func traitCategorySection(_ category: TraitCategory) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            // Category header
            HStack {
                CRTText(category.rawValue, style: .caption, glowIntensity: .subtle, color: theme.primary)

                Rectangle()
                    .fill(theme.dim.opacity(0.3))
                    .frame(height: 1)

                Text("\(traits.categoryTotal(for: category))")
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .foregroundColor(theme.dim)
                Text("PTS")
                    .font(CRTTheme.Typography.font(size: 8, weight: .medium))
                    .foregroundColor(theme.dim.opacity(0.6))
            }

            // Trait sliders
            ForEach(category.traits, id: \.self) { trait in
                traitSliderRow(trait)
            }
        }
    }

    // MARK: - Stepped Slider Row

    private func traitSliderRow(_ trait: PersonaTrait) -> some View {
        let info = traitDisplayInfo[trait]
        let value = traits.value(for: trait)

        return VStack(spacing: CRTTheme.Spacing.xxxs) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                Text(info?.label ?? trait.rawValue.uppercased())
                    .font(CRTTheme.Typography.font(size: 11, weight: .medium))
                    .tracking(0.5)
                    .foregroundColor(theme.dim)
                    .frame(width: 110, alignment: .leading)

                // Stepped slider (20 segments)
                SteppedSlider(
                    value: Binding(
                        get: { traits.value(for: trait) },
                        set: { traits.setValue($0, for: trait) }
                    ),
                    range: 0...TraitValues.traitMax
                )

                // Value display
                Text(String(format: "%02d/%d", value, TraitValues.traitMax))
                    .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                    .foregroundColor(value > 0 ? theme.primary : theme.dim.opacity(0.4))
                    .frame(width: 40, alignment: .trailing)
            }
        }
    }

    // MARK: - Save

    private func save() async {
        isSaving = true
        errorMessage = nil

        do {
            if let existingPersona = persona {
                let request = UpdatePersonaRequest(
                    name: name,
                    description: descriptionText,
                    traits: traits
                )
                _ = try await apiClient.updatePersona(id: existingPersona.id, request)
            } else {
                let request = CreatePersonaRequest(
                    name: name,
                    description: descriptionText,
                    traits: traits
                )
                _ = try await apiClient.createPersona(request)
            }
            dismiss()
            onSaved()
        } catch {
            isSaving = false
            errorMessage = "Failed to save: \(error.localizedDescription)"
        }
    }
}

// MARK: - Stepped Slider

/// A segmented volume-meter slider with 20 segments.
/// Tap/drag to set value. Includes haptic feedback.
struct SteppedSlider: View {
    @Environment(\.crtTheme) private var theme
    @Binding var value: Int
    let range: ClosedRange<Int>

    private var segmentCount: Int { range.upperBound - range.lowerBound }

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 1) {
                ForEach(0..<segmentCount, id: \.self) { index in
                    let segmentValue = range.lowerBound + index + 1
                    let isFilled = value >= segmentValue

                    Rectangle()
                        .fill(isFilled ? theme.primary : theme.dim.opacity(0.15))
                        .overlay(
                            isFilled ?
                                Rectangle().fill(theme.primary.opacity(0.3)) : nil
                        )
                        .overlay(
                            Rectangle()
                                .stroke(isFilled ? theme.primary.opacity(0.5) : theme.dim.opacity(0.2), lineWidth: 0.5)
                        )
                }
            }
            .frame(height: 14)
            .cornerRadius(1)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { gesture in
                        let fraction = gesture.location.x / geo.size.width
                        let newValue = range.lowerBound + Int(round(fraction * Double(segmentCount)))
                        let clamped = min(range.upperBound, max(range.lowerBound, newValue))
                        if clamped != value {
                            value = clamped
                            #if canImport(UIKit)
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred(intensity: 0.4)
                            #endif
                        }
                    }
            )
            .crtGlow(color: theme.primary, radius: value > 0 ? 2 : 0, intensity: value > 0 ? 0.2 : 0)
        }
        .frame(height: 14)
    }
}

// MARK: - Preview

#Preview("PersonaEditorView - Create") {
    PersonaEditorView(onSaved: {})
}

#Preview("PersonaEditorView - Edit") {
    let persona = Persona(
        id: "1", name: "Sentinel",
        description: "QA specialist with deep testing focus",
        traits: TraitValues(
            architectureFocus: 4, qaScalability: 6,
            qaCorrectness: 18, testingUnit: 16,
            testingAcceptance: 14, codeReview: 10
        ),
        createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z"
    )

    PersonaEditorView(persona: persona, onSaved: {})
}
