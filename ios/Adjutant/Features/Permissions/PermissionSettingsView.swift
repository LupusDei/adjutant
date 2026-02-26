import SwiftUI
import AdjutantKit

/// Permission configuration view for managing per-session permission modes.
struct PermissionSettingsView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel = PermissionSettingsViewModel()

    var body: some View {
        VStack(spacing: 0) {
            headerView
            settingsContent
        }
        .background(theme.background.screen)
        .onAppear { viewModel.onAppear() }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("PERMISSIONS", style: .subheader, glowIntensity: .medium)
                CRTText("AGENT PERMISSION CONFIG", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }
            Spacer()
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            theme.background.panel
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .bottom
                )
        )
    }

    // MARK: - Settings Content

    private var settingsContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                // Default mode
                defaultModeSection

                // Tool overrides
                toolOverridesSection

                // Session overrides
                if !viewModel.sessionOverrides.isEmpty {
                    sessionOverridesSection
                }

                // Error
                if let error = viewModel.errorMessage {
                    ErrorBanner(
                        message: error,
                        onRetry: { viewModel.onAppear() },
                        onDismiss: { viewModel.errorMessage = nil }
                    )
                }
            }
            .padding(CRTTheme.Spacing.md)
        }
    }

    // MARK: - Default Mode

    private var defaultModeSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("DEFAULT MODE", style: .caption, glowIntensity: .subtle, color: theme.dim)

            ForEach(PermissionModeOption.allCases, id: \.rawValue) { mode in
                modeRow(
                    mode: mode,
                    isSelected: viewModel.defaultMode == mode.rawValue,
                    onTap: {
                        viewModel.defaultMode = mode.rawValue
                        Task { await viewModel.saveConfig() }
                    }
                )
            }
        }
    }

    private func modeRow(mode: PermissionModeOption, isSelected: Bool, onTap: @escaping () -> Void) -> some View {
        Button(action: onTap) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: isSelected ? "circle.inset.filled" : "circle")
                    .font(.system(size: 16))
                    .foregroundColor(isSelected ? theme.primary : theme.dim)

                VStack(alignment: .leading, spacing: 2) {
                    Text(mode.label)
                        .font(.system(.caption, weight: .semibold))
                        .foregroundColor(isSelected ? theme.primary : theme.dim)
                    Text(mode.description)
                        .font(.system(.caption2))
                        .foregroundColor(theme.dim.opacity(0.7))
                }

                Spacer()
            }
            .padding(CRTTheme.Spacing.sm)
            .background(isSelected ? theme.primary.opacity(0.08) : Color.clear)
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Tool Overrides

    private var toolOverridesSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("TOOL OVERRIDES", style: .caption, glowIntensity: .subtle, color: theme.dim)

            ForEach(["Read", "Edit", "Write", "Bash", "Glob", "Grep", "Task"], id: \.self) { tool in
                toolOverrideRow(tool: tool)
            }
        }
    }

    private func toolOverrideRow(tool: String) -> some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: iconForTool(tool))
                .font(.system(size: 12))
                .foregroundColor(colorForTool(tool))
                .frame(width: 20)

            Text(tool)
                .font(.system(.caption, design: .monospaced, weight: .semibold))
                .foregroundColor(theme.primary)

            Spacer()

            Menu {
                Button("Inherit Default") {
                    viewModel.removeToolOverride(tool)
                    Task { await viewModel.saveConfig() }
                }
                ForEach(PermissionModeOption.allCases, id: \.rawValue) { mode in
                    Button(mode.label) {
                        viewModel.setToolOverride(tool, mode: mode.rawValue)
                        Task { await viewModel.saveConfig() }
                    }
                }
            } label: {
                Text(viewModel.toolOverrides[tool]?.uppercased() ?? "DEFAULT")
                    .font(.system(.caption2, weight: .semibold))
                    .foregroundColor(viewModel.toolOverrides[tool] != nil ? theme.primary : theme.dim)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.dim.opacity(0.1))
                    .cornerRadius(4)
            }
        }
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }

    // MARK: - Session Overrides

    private var sessionOverridesSection: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
            CRTText("SESSION OVERRIDES", style: .caption, glowIntensity: .subtle, color: theme.dim)

            ForEach(Array(viewModel.sessionOverrides.keys.sorted()), id: \.self) { sessionId in
                HStack {
                    Text(sessionId)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(theme.primary)

                    Spacer()

                    Text(viewModel.sessionOverrides[sessionId]?.uppercased() ?? "")
                        .font(.system(.caption2, weight: .semibold))
                        .foregroundColor(theme.dim)
                }
                .padding(.vertical, CRTTheme.Spacing.xxs)
            }
        }
    }

    // MARK: - Helpers

    private func iconForTool(_ tool: String) -> String {
        switch tool {
        case "Read": return "doc.text"
        case "Edit": return "pencil"
        case "Write": return "doc.badge.plus"
        case "Bash": return "terminal"
        case "Glob": return "magnifyingglass"
        case "Grep": return "text.magnifyingglass"
        case "Task": return "person.2"
        default: return "wrench"
        }
    }

    private func colorForTool(_ tool: String) -> Color {
        switch tool {
        case "Read": return .blue
        case "Edit", "Write": return .orange
        case "Bash": return .green
        case "Glob", "Grep": return .purple
        case "Task": return .cyan
        default: return .gray
        }
    }
}

// MARK: - Permission Mode Option

enum PermissionModeOption: String, CaseIterable {
    case manual
    case autoAccept = "auto_accept"
    case autoDeny = "auto_deny"

    var label: String {
        switch self {
        case .manual: return "MANUAL"
        case .autoAccept: return "AUTO-ACCEPT"
        case .autoDeny: return "AUTO-DENY"
        }
    }

    var description: String {
        switch self {
        case .manual: return "Route permission prompts to iOS for approval"
        case .autoAccept: return "Automatically approve all permissions"
        case .autoDeny: return "Automatically deny all permissions"
        }
    }
}

// MARK: - Permission Dialog

/// Modal permission dialog shown when an agent requests permission.
struct PermissionDialog: View {
    @Environment(\.crtTheme) private var theme
    let action: String
    let details: String
    let sessionName: String
    let onApprove: () -> Void
    let onDeny: () -> Void

    var body: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            // Icon
            Image(systemName: "exclamationmark.shield.fill")
                .font(.system(size: 48))
                .foregroundColor(.orange)

            // Title
            CRTText("PERMISSION REQUESTED", style: .subheader, glowIntensity: .bright)

            // Agent name
            CRTText(sessionName.uppercased(), style: .caption, glowIntensity: .subtle, color: .cyan)

            // Action
            Text(action)
                .font(.system(.body, design: .monospaced))
                .foregroundColor(theme.primary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            // Details
            if !details.isEmpty && details != action {
                Text(details)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundColor(theme.dim)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Buttons
            HStack(spacing: CRTTheme.Spacing.lg) {
                Button(action: onDeny) {
                    CRTText("DENY", style: .body, glowIntensity: .medium, color: .red)
                        .padding(.horizontal, CRTTheme.Spacing.xl)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                        .background(Color.red.opacity(0.15))
                        .cornerRadius(8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.red.opacity(0.3), lineWidth: 1)
                        )
                }

                Button(action: onApprove) {
                    CRTText("APPROVE", style: .body, glowIntensity: .bright, color: .green)
                        .padding(.horizontal, CRTTheme.Spacing.xl)
                        .padding(.vertical, CRTTheme.Spacing.sm)
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.green.opacity(0.3), lineWidth: 1)
                        )
                }
            }
        }
        .padding(CRTTheme.Spacing.lg)
        .background(theme.background.screen)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.orange.opacity(0.3), lineWidth: 2)
        )
        .shadow(color: .orange.opacity(0.2), radius: 20)
    }
}
