import SwiftUI
import AdjutantKit

// MARK: - Output Event Model

/// Structured output event from the Claude Code output parser.
/// Mirrors the backend OutputEvent type.
enum OutputEvent: Identifiable, Equatable {
    case message(id: UUID = UUID(), content: String)
    case toolUse(id: UUID = UUID(), tool: String, input: String)
    case toolResult(id: UUID = UUID(), tool: String, output: String, truncated: Bool)
    case status(id: UUID = UUID(), state: String)
    case permissionRequest(id: UUID = UUID(), action: String, details: String)
    case error(id: UUID = UUID(), message: String)
    case raw(id: UUID = UUID(), data: String)

    var id: UUID {
        switch self {
        case .message(let id, _),
             .toolUse(let id, _, _),
             .toolResult(let id, _, _, _),
             .status(let id, _),
             .permissionRequest(let id, _, _),
             .error(let id, _),
             .raw(let id, _):
            return id
        }
    }
}

// MARK: - Event Renderer

/// Renders a single OutputEvent into the appropriate view.
struct OutputEventRenderer: View {
    let event: OutputEvent

    var body: some View {
        switch event {
        case .message(_, let content):
            MessageBubble(content: content)
        case .toolUse(_, let tool, let input):
            ToolCard(tool: tool, input: input, output: nil, truncated: false)
        case .toolResult(_, let tool, let output, let truncated):
            ToolCard(tool: tool, input: nil, output: output, truncated: truncated)
        case .status(_, let state):
            StatusIndicator(state: state)
        case .permissionRequest(_, let action, let details):
            PermissionCard(action: action, details: details)
        case .error(_, let message):
            ErrorCard(message: message)
        case .raw(_, let data):
            RawOutputLine(text: data)
        }
    }
}

// MARK: - Message Bubble

/// Chat bubble for agent text messages.
struct MessageBubble: View {
    @Environment(\.crtTheme) private var theme
    let content: String

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                Text(content)
                    .font(.system(.body))
                    .foregroundColor(theme.primary)
                    .textSelection(.enabled)
            }
            .padding(CRTTheme.Spacing.sm)
            .background(theme.dim.opacity(0.08))
            .cornerRadius(12)

            Spacer(minLength: 40)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }
}

// MARK: - Tool Card

/// Collapsible card showing tool use and/or result.
struct ToolCard: View {
    @Environment(\.crtTheme) private var theme
    let tool: String
    let input: String?
    let output: String?
    let truncated: Bool

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header — always visible, tappable
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    Image(systemName: iconForTool(tool))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(colorForTool(tool))
                        .frame(width: 20)

                    Text(tool)
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundColor(colorForTool(tool))

                    if let input = input {
                        Text(input.prefix(40) + (input.count > 40 ? "..." : ""))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundColor(theme.dim)
                            .lineLimit(1)
                    }

                    Spacer()

                    if truncated {
                        Text("TRUNCATED")
                            .font(.system(.caption2, weight: .semibold))
                            .foregroundColor(.orange)
                    }

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10))
                        .foregroundColor(theme.dim)
                }
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
            }
            .buttonStyle(.plain)

            // Expanded content
            if isExpanded {
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
                    if let input = input, !input.isEmpty {
                        Text("Input:")
                            .font(.system(.caption2, weight: .semibold))
                            .foregroundColor(theme.dim)
                        Text(input)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundColor(theme.primary.opacity(0.8))
                            .textSelection(.enabled)
                    }

                    if let output = output, !output.isEmpty {
                        Text("Output:")
                            .font(.system(.caption2, weight: .semibold))
                            .foregroundColor(theme.dim)
                        Text(output.prefix(2000) + (output.count > 2000 ? "\n... (truncated)" : ""))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundColor(theme.primary.opacity(0.7))
                            .textSelection(.enabled)
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.bottom, CRTTheme.Spacing.xs)
            }
        }
        .background(colorForTool(tool).opacity(0.06))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(colorForTool(tool).opacity(0.2), lineWidth: 1)
        )
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }

    private func iconForTool(_ tool: String) -> String {
        switch tool {
        case "Read": return "doc.text"
        case "Edit": return "pencil"
        case "Write": return "doc.badge.plus"
        case "Bash": return "terminal"
        case "Glob": return "magnifyingglass"
        case "Grep": return "text.magnifyingglass"
        case "Task": return "person.2"
        case "WebSearch": return "globe"
        case "WebFetch": return "arrow.down.doc"
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
        case "WebSearch", "WebFetch": return .indigo
        default: return .gray
        }
    }
}

// MARK: - Status Indicator

/// Inline status indicator (thinking, working, idle).
struct StatusIndicator: View {
    @Environment(\.crtTheme) private var theme
    let state: String

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            if state == "thinking" || state == "working" {
                ProgressView()
                    .scaleEffect(0.6)
                    .frame(width: 16, height: 16)
            } else {
                Circle()
                    .fill(state == "idle" ? Color.yellow : Color.gray)
                    .frame(width: 8, height: 8)
            }

            Text(state.uppercased())
                .font(.system(.caption2, weight: .semibold))
                .foregroundColor(theme.dim)
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }
}

// MARK: - Permission Card

/// Permission request card with action details.
struct PermissionCard: View {
    @Environment(\.crtTheme) private var theme
    let action: String
    let details: String

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                Image(systemName: "exclamationmark.shield")
                    .font(.system(size: 14))
                    .foregroundColor(.orange)
                Text("PERMISSION: \(action)")
                    .font(.system(.caption, weight: .semibold))
                    .foregroundColor(.orange)
            }

            Text(details)
                .font(.system(.caption2, design: .monospaced))
                .foregroundColor(theme.primary.opacity(0.8))
                .textSelection(.enabled)
        }
        .padding(CRTTheme.Spacing.sm)
        .background(Color.orange.opacity(0.08))
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.orange.opacity(0.2), lineWidth: 1)
        )
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }
}

// MARK: - Error Card

/// Error message card.
struct ErrorCard: View {
    @Environment(\.crtTheme) private var theme
    let message: String

    var body: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 12))
                .foregroundColor(.red)
            Text(message)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.red)
        }
        .padding(CRTTheme.Spacing.sm)
        .background(Color.red.opacity(0.08))
        .cornerRadius(8)
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xxs)
    }
}

// MARK: - Raw Output Line

/// Single line of raw terminal output (fallback for unparsed content).
struct RawOutputLine: View {
    @Environment(\.crtTheme) private var theme
    let text: String

    var body: some View {
        Text(text)
            .font(.system(.caption, design: .monospaced))
            .foregroundColor(theme.primary.opacity(0.7))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, CRTTheme.Spacing.md)
    }
}
