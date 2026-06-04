import SwiftUI
import Combine
import AdjutantKit

/// Pip-Boy themed triage screen for open agent questions (adj-181.5 / US4).
///
/// Displays all open questions sorted blocking→high→normal→low then oldest-first.
/// Each row shows: urgency badge, agent, category chip, body, expandable context,
/// suggested-option quick-pick buttons, free-text answer box, and a dismiss action.
///
/// Live WS updates (`question:new`, `question:answered`, `question:dismissed`) are
/// handled by subscribing to a `WebSocketClient` created for this view. The WS
/// payload carries the question data in the standard `WsServerMessage` envelope;
/// for `question:new` the body is the JSON-encoded `AgentQuestion`, for
/// `question:answered|dismissed` the `id` field identifies the question.
///
/// Deep-linked from the `question:new` APNS push via `adjutant://questions`
/// (handled in `AppCoordinator`).
struct OpenQuestionsView: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject var viewModel: OpenQuestionsViewModel

    /// Reuse the shared app WS client if provided; otherwise create one.
    /// In production the view is created with `nil` and creates its own connection.
    /// Tests that don't exercise live WS can pass any value.
    private let wsClient: WebSocketClient?

    // Cancellables for WS subscription (stored as a class so it can be mutated)
    @StateObject private var wsBridge = QuestionsWSBridge()

    init(viewModel: OpenQuestionsViewModel, wsClient: WebSocketClient? = nil) {
        self.viewModel = viewModel
        self.wsClient = wsClient
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            filterBar
            questionList
        }
        .background(theme.background.screen)
        .task { await viewModel.loadQuestions() }
        .onAppear {
            wsBridge.connect(
                baseURL: AppState.shared.apiBaseURL,
                apiKey: AppState.shared.apiKey,
                viewModel: viewModel
            )
        }
        .onDisappear {
            wsBridge.disconnect()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("OPEN QUESTIONS", style: .subheader, glowIntensity: .medium)
                CRTText("\(viewModel.filteredQuestions.count) AWAITING RESPONSE",
                        style: .caption, glowIntensity: .subtle, color: theme.dim)
            }
            Spacer()
            if viewModel.isLoading {
                ProgressView()
                    .tint(theme.primary)
                    .scaleEffect(0.8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Divider().background(theme.primary.opacity(0.3))
        }
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Urgency filter
                ForEach(QuestionUrgency.allCases, id: \.self) { urgency in
                    FilterChip(
                        label: urgency.rawValue.uppercased(),
                        isActive: viewModel.filterUrgency == urgency,
                        color: urgencyColor(urgency)
                    ) {
                        if viewModel.filterUrgency == urgency {
                            viewModel.filterUrgency = nil
                        } else {
                            viewModel.filterUrgency = urgency
                        }
                    }
                }

                Divider()
                    .frame(height: 16)
                    .background(theme.primary.opacity(0.3))

                // Category filter
                ForEach(QuestionCategory.allCases, id: \.self) { category in
                    FilterChip(
                        label: category.displayName,
                        isActive: viewModel.filterCategory == category,
                        color: theme.primary
                    ) {
                        if viewModel.filterCategory == category {
                            viewModel.filterCategory = nil
                        } else {
                            viewModel.filterCategory = category
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .overlay(alignment: .bottom) {
            Divider().background(theme.primary.opacity(0.15))
        }
    }

    // MARK: - Question List

    @ViewBuilder
    private var questionList: some View {
        if viewModel.filteredQuestions.isEmpty {
            emptyState
        } else {
            ScrollView {
                LazyVStack(spacing: 1) {
                    ForEach(viewModel.filteredQuestions) { question in
                        QuestionRow(
                            question: question,
                            onAnswer: { body, option in
                                Task<Void, Never> {
                                    await viewModel.answer(
                                        questionId: question.id,
                                        answerBody: body,
                                        chosenOption: option
                                    )
                                }
                            },
                            onDismiss: {
                                Task<Void, Never> {
                                    await viewModel.dismiss(questionId: question.id)
                                }
                            }
                        )
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            CRTText("> NO OPEN QUESTIONS", style: .body, glowIntensity: .subtle, color: theme.dim)
            CRTText("ALL AGENTS UNBLOCKED", style: .caption, glowIntensity: .none, color: theme.dim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Helpers

    private func urgencyColor(_ urgency: QuestionUrgency) -> Color {
        switch urgency {
        case .blocking: return .red
        case .high:     return .orange
        case .normal:   return theme.primary
        case .low:      return theme.dim
        }
    }
}

// MARK: - QuestionRow

/// A single triage row: urgency badge, agent, category chip, body,
/// expandable context, suggested-option quick-pick, free-text answer, dismiss.
private struct QuestionRow: View {
    @Environment(\.crtTheme) private var theme
    let question: AgentQuestion
    var onAnswer: (String?, String?) -> Void
    var onDismiss: () -> Void

    @State private var isContextExpanded = false
    @State private var answerText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            rowHeader
            bodyText
            contextBlock
            suggestedOptions
            freeTextAnswer
            actionRow
        }
        // Expand to fill the scroll view width so FlowLayout receives a finite
        // container width and chips never overflow horizontally (adj-181.24).
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(theme.background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(urgencyBorderColor, lineWidth: 1)
        )
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
    }

    // MARK: - Row Header

    private var rowHeader: some View {
        HStack(spacing: 8) {
            // Urgency badge
            Text(question.urgency.rawValue.uppercased())
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(urgencyBorderColor.opacity(0.2))
                .foregroundColor(urgencyBorderColor)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(urgencyBorderColor, lineWidth: 1)
                )

            // Agent name
            CRTText(question.agentId.uppercased(),
                    style: .caption, glowIntensity: .subtle)

            Spacer()

            // Category chip
            if let category = question.category {
                Text(category.displayName)
                    .font(.system(size: 9, weight: .medium, design: .monospaced))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(theme.primary.opacity(0.1))
                    .foregroundColor(theme.primary.opacity(0.7))
                    .overlay(
                        RoundedRectangle(cornerRadius: 2)
                            .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                    )
            }

            // Age
            CRTText(ageString, style: .caption, glowIntensity: .none, color: theme.dim)
        }
    }

    // MARK: - Body

    private var bodyText: some View {
        CRTText(question.body, style: .body, glowIntensity: .subtle)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: - Context (expandable)

    @ViewBuilder
    private var contextBlock: some View {
        if let context = question.context, !context.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    isContextExpanded.toggle()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isContextExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 10))
                            .foregroundColor(theme.dim)
                        CRTText("CONTEXT",
                                style: .caption, glowIntensity: .none, color: theme.dim)
                    }
                }
                .buttonStyle(.plain)

                if isContextExpanded {
                    Text(context)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(theme.primary.opacity(0.7))
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(8)
                        .background(theme.background.screen)
                        .overlay(
                            RoundedRectangle(cornerRadius: 2)
                                .stroke(theme.primary.opacity(0.2), lineWidth: 1)
                        )
                }
            }
        }
    }

    // MARK: - Suggested Options (quick-pick)

    @ViewBuilder
    private var suggestedOptions: some View {
        if let options = question.suggestedOptions, !options.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                CRTText("QUICK PICK:", style: .caption, glowIntensity: .none, color: theme.dim)
                FlowLayout(spacing: 6) {
                    ForEach(options, id: \.self) { option in
                        Button {
                            onAnswer(nil, option)
                        } label: {
                            Text(option)
                                .font(.system(size: 12, weight: .medium, design: .monospaced))
                                // Allow text to wrap to multiple lines when FlowLayout
                                // constrains chip width to the container (adj-181.24).
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(theme.primary.opacity(0.15))
                                .foregroundColor(theme.primary)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 2)
                                        .stroke(theme.primary.opacity(0.6), lineWidth: 1)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Free-text Answer

    private var freeTextAnswer: some View {
        HStack(spacing: 6) {
            TextField("TYPE ANSWER...", text: $answerText)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(theme.background.screen)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(theme.primary.opacity(0.4), lineWidth: 1)
                )

            Button("SEND") {
                let body = answerText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !body.isEmpty else { return }
                onAnswer(body, nil)
                answerText = ""
            }
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .foregroundColor(theme.primary)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(theme.primary, lineWidth: 1)
            )
            .disabled(answerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    // MARK: - Action Row (dismiss)

    private var actionRow: some View {
        HStack {
            Spacer()
            Button("DISMISS") {
                onDismiss()
            }
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundColor(theme.dim)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(theme.dim.opacity(0.5), lineWidth: 1)
            )
        }
    }

    // MARK: - Computed

    private var urgencyBorderColor: Color {
        switch question.urgency {
        case .blocking: return .red
        case .high:     return .orange
        case .normal:   return Color(red: 0, green: 0.67, blue: 0)  // --pipboy-green-dim
        case .low:      return Color(red: 0, green: 0.67, blue: 0).opacity(0.5)
        }
    }

    /// Human-readable age from `createdAt` SQLite timestamp string.
    /// Falls back to "?" on parse failure — never crashes.
    private var ageString: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let date = formatter.date(from: question.createdAt) else { return "?" }
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return "<1M" }
        if interval < 3600 { return "\(Int(interval / 60))M" }
        if interval < 86400 { return "\(Int(interval / 3600))H" }
        return "\(Int(interval / 86400))D"
    }
}

// MARK: - FilterChip

/// Toggleable filter pill for the filter bar.
private struct FilterChip: View {
    @Environment(\.crtTheme) private var theme
    let label: String
    let isActive: Bool
    let color: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(isActive ? color.opacity(0.2) : Color.clear)
                .foregroundColor(isActive ? color : color.opacity(0.5))
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(isActive ? color : color.opacity(0.3), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - FlowLayout

/// A simple left-to-right wrapping layout for suggested-option chips.
///
/// Items are sized against the available container width (never unbounded) so that
/// a long chip wraps its text instead of inflating the card past the screen edge.
private struct FlowLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        // Guard against nil / infinite proposals — use a large but finite fallback only
        // when the parent genuinely provides no width constraint (e.g. inside a ScrollView
        // that has unbounded width). On screen this will always be a finite screen width.
        let availableWidth = (proposal.width.map { $0.isFinite ? $0 : 390 }) ?? 390
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxWidth: CGFloat = 0

        for subview in subviews {
            // Clamp to available width so text wraps within the chip rather than overflowing.
            let size = subview.sizeThatFits(ProposedViewSize(width: availableWidth, height: nil))
            let itemWidth = min(size.width, availableWidth)
            if x + itemWidth > availableWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += itemWidth + spacing
            rowHeight = max(rowHeight, size.height)
            maxWidth = max(maxWidth, x)
        }
        // Never report a width wider than what was proposed.
        return CGSize(width: min(maxWidth, availableWidth), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let availableWidth = bounds.width.isFinite ? bounds.width : 390
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            // Clamp to available width so chips never overflow the card boundary.
            let size = subview.sizeThatFits(ProposedViewSize(width: availableWidth, height: nil))
            let itemWidth = min(size.width, availableWidth)
            if x + itemWidth > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(
                at: CGPoint(x: x, y: y),
                proposal: ProposedViewSize(width: itemWidth, height: size.height)
            )
            x += itemWidth + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - QuestionCategory + Display

private extension QuestionCategory {
    var displayName: String {
        switch self {
        case .decision:       return "DECISION"
        case .clarification:  return "CLARIFY"
        case .approval:       return "APPROVAL"
        case .actionRequired: return "ACTION"
        case .other:          return "OTHER"
        }
    }
}

// MARK: - QuestionsWSBridge

/// Bridges the raw WebSocket to the `OpenQuestionsViewModel` for live updates.
///
/// Listens for `question:new`, `question:answered`, and `question:dismissed`
/// events. The `question:new` payload encodes an `AgentQuestion` in the WS
/// message body (JSON string); answered/dismissed carry the question id.
///
/// This class is an `ObservableObject` only so SwiftUI can hold it as a
/// `@StateObject` — no published properties are needed; mutations go through
/// the ViewModel.
@MainActor
private final class QuestionsWSBridge: ObservableObject {
    private var wsClient: WebSocketClient?
    private var cancellables = Set<AnyCancellable>()
    private weak var viewModel: OpenQuestionsViewModel?

    private static let decoder = JSONDecoder()

    func connect(baseURL: URL, apiKey: String?, viewModel: OpenQuestionsViewModel) {
        guard wsClient == nil else { return }
        self.viewModel = viewModel

        let client = WebSocketClient(baseURL: baseURL, apiKey: apiKey)
        self.wsClient = client

        client.messageSubject
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                self?.handleMessage(msg)
            }
            .store(in: &cancellables)

        client.connect()
    }

    func disconnect() {
        wsClient?.disconnect()
        wsClient = nil
        cancellables.removeAll()
    }

    private func handleMessage(_ msg: WsServerMessage) {
        switch msg.type {
        case "question:new":
            // The `data` field carries the JSON-encoded AgentQuestion payload.
            // Fall back to `body` for forward-compatibility.
            let jsonString = msg.data ?? msg.body
            guard let jsonString,
                  let data = jsonString.data(using: .utf8),
                  let question = try? Self.decoder.decode(AgentQuestion.self, from: data)
            else { return }
            viewModel?.handleQuestionNew(question)

        case "question:answered":
            guard let id = msg.id ?? msg.relatedId else { return }
            viewModel?.handleQuestionAnswered(id: id)

        case "question:dismissed":
            guard let id = msg.id ?? msg.relatedId else { return }
            viewModel?.handleQuestionDismissed(id: id)

        default:
            break
        }
    }
}
