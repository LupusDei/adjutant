import SwiftUI

/// The Mission Control project-selector sheet (adj-209.3.2).
///
/// A filter UI over the portfolio: **Select all** / **Deselect all** plus a per-project toggle
/// row each. Deliberately decoupled from the ViewModel — it takes a pure
/// ``MissionControlSelectorModel`` (verified in `MissionControlSelectorModelTests`) plus action
/// closures, so all state lives in the VM (adj-209.2.3), which persists the selection and re-fetches
/// with the derived `projectIds`. No scroll container (a portfolio is a short list) so it also
/// renders cleanly offscreen for validation.
struct MissionControlSelectorView: View {
    let model: MissionControlSelectorModel
    var onSelectAll: () -> Void = {}
    var onDeselectAll: () -> Void = {}
    var onToggle: (String) -> Void = { _ in }
    var onDone: () -> Void = {}

    @Environment(\.crtTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
            header
            bulkButtons
            Divider().overlay(theme.dim.opacity(0.4))
            if model.rows.isEmpty {
                CRTText("NO PROJECTS REPORTING ACTIVITY", style: .caption, color: theme.dim)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, CRTTheme.Spacing.lg)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.rows) { row in
                        projectRow(row)
                        if row.id != model.rows.last?.id {
                            Divider().overlay(theme.dim.opacity(0.15))
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(CRTTheme.Spacing.lg)
        .background(theme.background.screen)
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("FILTER PROJECTS", style: .subheader, color: CRTTheme.Brand.cyanText)
                CRTText(model.summary, style: .caption, color: theme.textSecondary)
            }
            Spacer()
            Button(action: onDone) {
                CRTText("DONE", style: .caption, color: CRTTheme.Brand.cyanText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Done")
        }
    }

    // MARK: - Bulk actions

    private var bulkButtons: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            CRTButton("SELECT ALL", variant: model.isAllSelected ? .secondary : .primary, size: .small,
                      action: onSelectAll)
                .disabled(model.isAllSelected)
                .opacity(model.isAllSelected ? 0.5 : 1)
            CRTButton("DESELECT ALL", variant: .secondary, size: .small, action: onDeselectAll)
                .disabled(model.isNoneSelected)
                .opacity(model.isNoneSelected ? 0.5 : 1)
        }
    }

    // MARK: - Project row

    private func projectRow(_ row: MissionControlSelectorModel.Row) -> some View {
        Button {
            onToggle(row.id)
        } label: {
            HStack(spacing: CRTTheme.Spacing.md) {
                checkbox(isOn: row.isSelected)
                CRTText(row.name, style: .body, color: row.isSelected ? theme.textPrimary : theme.dim)
                Spacer()
            }
            .contentShape(Rectangle())
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.name)
        .accessibilityValue(row.isSelected ? "Selected" : "Not selected")
        .accessibilityAddTraits(row.isSelected ? [.isButton, .isSelected] : .isButton)
    }

    /// A CRT-styled checkbox: a bright filled square with a check when on, a hollow dim box when off.
    private func checkbox(isOn: Bool) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 3)
                .stroke(isOn ? CRTTheme.Brand.cyan : theme.dim, lineWidth: 1.5)
                .background(
                    RoundedRectangle(cornerRadius: 3)
                        .fill(isOn ? CRTTheme.Brand.cyan.opacity(0.22) : Color.clear)
                )
                .frame(width: 20, height: 20)
            if isOn {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(CRTTheme.Brand.cyanText)
            }
        }
    }
}

#if DEBUG
#Preview("Selector — partial") {
    MissionControlSelectorView(model: MissionControlSelectorModel(
        projects: [.init(id: "adjutant", name: "Adjutant"),
                   .init(id: "bloomfolio", name: "Bloomfolio"),
                   .init(id: "runway", name: "Runway")],
        selectedIds: ["adjutant", "runway"]
    ))
    .frame(width: 360, height: 420)
    .crtTheme(.starcraft)
}

#Preview("Selector — all") {
    MissionControlSelectorView(model: MissionControlSelectorModel(
        projects: [.init(id: "adjutant", name: "Adjutant"),
                   .init(id: "bloomfolio", name: "Bloomfolio")],
        selectedIds: nil
    ))
    .frame(width: 360, height: 360)
    .crtTheme(.starcraft)
}
#endif
