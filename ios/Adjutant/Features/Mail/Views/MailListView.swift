import SwiftUI
import AdjutantKit

/// Mail inbox list view displaying messages with filtering and search.
@MainActor
struct MailListView: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel: MailListViewModel
    @EnvironmentObject private var coordinator: AppCoordinator
    @ObservedObject private var appState = AppState.shared

    init() {
        _viewModel = StateObject(wrappedValue: MailListViewModel())
    }

    init(viewModel: MailListViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with rig filter and power status
            AppHeaderView(
                title: "MAIL",
                availableRigs: appState.availableRigs,
                isLoading: viewModel.isLoading,
                onPowerTap: { coordinator.navigate(to: .settings) }
            )
            .padding(.vertical, CRTTheme.Spacing.sm)

            // Filter bar
            filterBar

            // Search bar (when active)
            if viewModel.isSearching {
                searchBar
            }

            // Content
            if viewModel.isLoading && viewModel.messages.isEmpty {
                loadingView
            } else if let error = viewModel.errorMessage {
                errorView(message: error)
            } else if viewModel.isEmpty {
                emptyView
            } else {
                messageList
            }
        }
        .background(CRTTheme.Background.screen)
        #if os(iOS)
        .navigationBarHidden(true)
        #endif
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        HStack(spacing: CRTTheme.Spacing.xs) {
            ForEach(MailListViewModel.MailFilter.allCases) { filter in
                FilterChip(
                    title: filter.displayName,
                    isSelected: viewModel.currentFilter == filter,
                    count: filter == .unread ? viewModel.unreadCount : nil
                ) {
                    withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                        viewModel.currentFilter = filter
                    }
                }
            }

            Spacer()

            searchButton
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.panel.opacity(0.5))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(theme.primary.opacity(0.2)),
            alignment: .bottom
        )
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: CRTTheme.Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(theme.dim)
                .font(.system(size: 14))

            TextField("Search messages...", text: $viewModel.searchText)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                #if os(iOS)
                .autocapitalization(.none)
                #endif
                .disableAutocorrection(true)

            if !viewModel.searchText.isEmpty {
                Button {
                    viewModel.searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(theme.dim)
                        .font(.system(size: 14))
                }
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(CRTTheme.Background.elevated)
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(theme.primary.opacity(0.3), lineWidth: 1)
        )
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private var searchButton: some View {
        Button {
            withAnimation(.easeInOut(duration: CRTTheme.Animation.fast)) {
                viewModel.isSearching.toggle()
                if !viewModel.isSearching {
                    viewModel.searchText = ""
                }
            }
        } label: {
            Image(systemName: viewModel.isSearching ? "xmark" : "magnifyingglass")
                .foregroundColor(theme.primary)
                .font(.system(size: 16, weight: .medium))
        }
    }

    // MARK: - Message List

    private var messageList: some View {
        List {
            ForEach(viewModel.filteredMessages) { message in
                MailRowView(message: message)
                    .listRowBackground(CRTTheme.Background.screen)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(
                        top: CRTTheme.Spacing.xs,
                        leading: CRTTheme.Spacing.md,
                        bottom: CRTTheme.Spacing.xs,
                        trailing: CRTTheme.Spacing.md
                    ))
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        Button {
                            Task {
                                await viewModel.toggleReadStatus(message)
                            }
                        } label: {
                            Label(
                                message.read ? "Unread" : "Read",
                                systemImage: message.read ? "envelope.badge" : "envelope.open"
                            )
                        }
                        .tint(theme.primary)
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            Task {
                                await viewModel.deleteMessage(message)
                            }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .onTapGesture {
                        coordinator.navigate(to: .mailDetail(id: message.id))
                    }
            }
            .onDelete { offsets in
                Task {
                    await viewModel.deleteMessages(at: offsets)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(CRTTheme.Background.screen)
        .refreshable {
            await viewModel.loadMessages()
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack {
            Spacer()
            LoadingIndicator(text: "LOADING MESSAGES")
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.lg) {
            Spacer()
            ErrorBanner(
                message: message,
                details: "Pull down to retry",
                onRetry: {
                    Task {
                        await viewModel.loadMessages()
                    }
                }
            )
            .padding(.horizontal, CRTTheme.Spacing.md)
            Spacer()
        }
    }

    // MARK: - Empty View

    private var emptyView: some View {
        VStack {
            Spacer()
            EmptyStateView(
                title: "NO MESSAGES",
                message: viewModel.emptyStateMessage,
                icon: "envelope"
            )
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Filter Chip

/// A selectable filter chip button
private struct FilterChip: View {
    @Environment(\.crtTheme) private var theme

    let title: String
    let isSelected: Bool
    let count: Int?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: CRTTheme.Spacing.xxs) {
                Text(title)
                    .font(CRTTheme.Typography.font(size: 12, weight: isSelected ? .bold : .medium))
                    .tracking(CRTTheme.Typography.letterSpacing)

                if let count = count, count > 0 {
                    Text("\(count)")
                        .font(CRTTheme.Typography.font(size: 10, weight: .bold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(isSelected ? theme.bright : theme.primary.opacity(0.3))
                        )
                        .foregroundColor(isSelected ? CRTTheme.Background.screen : theme.primary)
                }
            }
            .foregroundColor(isSelected ? CRTTheme.Background.screen : theme.primary)
            .padding(.horizontal, CRTTheme.Spacing.sm)
            .padding(.vertical, CRTTheme.Spacing.xs)
            .background(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .fill(isSelected ? theme.primary : theme.primary.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.primary.opacity(isSelected ? 0 : 0.3), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .crtGlow(color: theme.primary, radius: isSelected ? 4 : 0, intensity: isSelected ? 0.3 : 0)
    }
}

// MARK: - Mail Row View

/// A single row in the mail list displaying message preview
struct MailRowView: View {
    @Environment(\.crtTheme) private var theme

    let message: Message

    var body: some View {
        HStack(alignment: .top, spacing: CRTTheme.Spacing.sm) {
            // Unread indicator
            Circle()
                .fill(message.read ? Color.clear : theme.bright)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
                // Top row: From and Date
                HStack {
                    Text(message.senderName.uppercased())
                        .font(CRTTheme.Typography.font(
                            size: 14,
                            weight: message.read ? .regular : .bold
                        ))
                        .tracking(CRTTheme.Typography.letterSpacing)
                        .foregroundColor(message.read ? theme.primary : theme.bright)
                        .lineLimit(1)

                    Spacer()

                    Text(formattedDate)
                        .font(CRTTheme.Typography.font(size: 11))
                        .foregroundColor(theme.dim)
                }

                // Subject
                Text(message.subject)
                    .font(CRTTheme.Typography.font(
                        size: 13,
                        weight: message.read ? .regular : .medium
                    ))
                    .foregroundColor(message.read ? theme.primary.opacity(0.8) : theme.primary)
                    .lineLimit(1)

                // Body preview
                Text(message.body)
                    .font(CRTTheme.Typography.font(size: 12))
                    .foregroundColor(theme.dim)
                    .lineLimit(2)

                // Bottom row: Priority and Type badges
                HStack(spacing: CRTTheme.Spacing.xs) {
                    if message.priority.rawValue <= MessagePriority.high.rawValue {
                        BadgeView(priorityLabel, style: .priority(message.priority.rawValue))
                    }

                    if message.pinned {
                        BadgeView("PINNED", style: .label)
                    }

                    Spacer()
                }
            }
        }
        .padding(CRTTheme.Spacing.sm)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .fill(CRTTheme.Background.panel.opacity(message.read ? 0.3 : 0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                .stroke(
                    message.read ? theme.dim.opacity(0.2) : theme.primary.opacity(0.4),
                    lineWidth: 1
                )
        )
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(message.read ? "" : "Unread, ")From \(message.senderName), \(message.subject)")
        .accessibilityHint("Tap to view message")
    }

    private var formattedDate: String {
        guard let date = message.date else { return "" }

        let calendar = Calendar.current
        let now = Date()

        if calendar.isDateInToday(date) {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            return formatter.string(from: date)
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else if calendar.isDate(date, equalTo: now, toGranularity: .weekOfYear) {
            let formatter = DateFormatter()
            formatter.dateFormat = "EEE"
            return formatter.string(from: date).uppercased()
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "MMM d"
            return formatter.string(from: date).uppercased()
        }
    }

    private var priorityLabel: String {
        switch message.priority {
        case .urgent: return "P0"
        case .high: return "P1"
        case .normal: return "P2"
        case .low: return "P3"
        case .lowest: return "P4"
        }
    }
}

// MARK: - Preview

#Preview("Mail List") {
    NavigationStack {
        MailListView(viewModel: MailListViewModel())
    }
    .environmentObject(AppCoordinator())
    .preferredColorScheme(.dark)
}

#Preview("Mail List - Empty") {
    NavigationStack {
        MailListView(viewModel: {
            let vm = MailListViewModel()
            return vm
        }())
    }
    .environmentObject(AppCoordinator())
    .preferredColorScheme(.dark)
}

#Preview("Mail Row") {
    VStack(spacing: 12) {
        MailRowView(message: MailListViewModel.mockMessages[0])
        MailRowView(message: MailListViewModel.mockMessages[1])
        MailRowView(message: MailListViewModel.mockMessages[3])
    }
    .padding()
    .background(CRTTheme.Background.screen)
    .preferredColorScheme(.dark)
}
