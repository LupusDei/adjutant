import SwiftUI
import AdjutantKit

/// Terminal mode toggle for session chat.
/// Provides a raw terminal view alongside the structured chat view.
/// Toggle between "Chat" mode (parsed output) and "Terminal" mode (raw ANSI).
struct SessionModeToggle: View {
    @Environment(\.crtTheme) private var theme
    @Binding var mode: SessionViewMode

    var body: some View {
        HStack(spacing: 0) {
            modeButton(title: "CHAT", icon: "bubble.left", targetMode: .chat)
            modeButton(title: "TERMINAL", icon: "terminal", targetMode: .terminal)
        }
        .background(theme.dim.opacity(0.1))
        .cornerRadius(8)
    }

    private func modeButton(title: String, icon: String, targetMode: SessionViewMode) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                mode = targetMode
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 10))
                Text(title)
                    .font(.system(.caption2, weight: .semibold))
            }
            .foregroundColor(mode == targetMode ? theme.primary : theme.dim)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(mode == targetMode ? theme.primary.opacity(0.15) : Color.clear)
            .cornerRadius(6)
        }
        .buttonStyle(.plain)
    }
}

/// View mode for the session display
enum SessionViewMode {
    case chat
    case terminal
}

/// Raw terminal view displaying ANSI-stripped output in monospace.
/// Designed to be replaced with SwiftTerm UIViewRepresentable when
/// the SwiftTerm SPM dependency is added to the project.
struct TerminalOutputView: View {
    @Environment(\.crtTheme) private var theme
    let outputLines: [SessionChatViewModel.OutputLine]
    @State private var scrollProxy: ScrollViewProxy?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: true) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(outputLines) { line in
                        Text(line.text)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(colorForLine(line.text))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .id(line.id)
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("terminal-bottom")
                }
                .padding(CRTTheme.Spacing.xs)
            }
            .background(Color.black)
            .onAppear {
                scrollProxy = proxy
            }
            .onChange(of: outputLines.count) { _, _ in
                withAnimation(.easeOut(duration: 0.1)) {
                    proxy.scrollTo("terminal-bottom", anchor: .bottom)
                }
            }
        }
    }

    /// Basic ANSI-inspired coloring based on line content patterns
    private func colorForLine(_ text: String) -> Color {
        if text.hasPrefix("Error") || text.hasPrefix("error") || text.contains("FAIL") {
            return .red
        }
        if text.hasPrefix("Warning") || text.hasPrefix("warning") || text.contains("WARN") {
            return .yellow
        }
        if text.hasPrefix("✓") || text.contains("PASS") || text.contains("passed") {
            return .green
        }
        if text.hasPrefix("⏺") {
            return .cyan
        }
        return theme.primary
    }
}
