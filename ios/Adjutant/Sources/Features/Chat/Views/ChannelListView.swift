import SwiftUI
import AdjutantKit

/// Channel list surface (adj-164.6.3): the rooms the operator can open, each
/// with an unread badge and member count, plus a create action. Pip-Boy themed.
struct ChannelListView: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject var viewModel: ChannelViewModel

    /// Invoked when a channel row is tapped; the container opens its room view.
    var onSelect: (Channel) -> Void = { _ in }

    @State private var showCreateSheet = false

    var body: some View {
        VStack(spacing: 0) {
            header
            list
        }
        .background(theme.background.screen)
        .task { await viewModel.loadChannels() }
        .sheet(isPresented: $showCreateSheet) {
            CreateChannelSheet { title in
                Task { await viewModel.createChannel(title: title) }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                CRTText("CHANNELS", style: .subheader, glowIntensity: .medium)
                CRTText("MULTI-PARTY ROOMS", style: .caption, glowIntensity: .subtle, color: theme.dim)
            }
            Spacer()
            Button {
                showCreateSheet = true
            } label: {
                Image(systemName: "plus.circle")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(theme.primary)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Create channel")
        }
        .padding(.horizontal, CRTTheme.Spacing.md)
        .padding(.vertical, CRTTheme.Spacing.sm)
        .background(
            theme.background.panel.overlay(
                Rectangle().frame(height: 1).foregroundColor(theme.dim.opacity(0.3)),
                alignment: .bottom
            )
        )
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if viewModel.channels.isEmpty && !viewModel.isLoading {
                    emptyState
                }
                ForEach(viewModel.channels) { channel in
                    channelRow(channel)
                    if channel.id != viewModel.channels.last?.id {
                        Divider().background(theme.dim.opacity(0.3))
                    }
                }
                if viewModel.isLoading && viewModel.channels.isEmpty {
                    LoadingIndicator(size: .medium).padding()
                }
            }
        }
        .refreshable { await viewModel.loadChannels() }
    }

    @ViewBuilder
    private func channelRow(_ channel: Channel) -> some View {
        Button {
            viewModel.selectChannel(channel.id)
            onSelect(channel)
        } label: {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: "number")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(theme.dim)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    CRTText(channel.displayTitle.uppercased(), style: .body, glowIntensity: .subtle)
                    CRTText(
                        "\(channel.memberCount) MEMBER\(channel.memberCount == 1 ? "" : "S")",
                        style: .caption,
                        glowIntensity: .none,
                        color: theme.dim
                    )
                }
                Spacer()

                let unread = viewModel.unreadCount(for: channel.id)
                if unread > 0 {
                    Text("\(unread)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                        .foregroundColor(theme.background.screen)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.primary)
                        .clipShape(Capsule())
                        .accessibilityLabel("\(unread) unread")
                }
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "rectangle.3.group.bubble")
                .font(.system(size: 44))
                .foregroundColor(theme.dim)
            CRTText("NO CHANNELS", style: .subheader, glowIntensity: .subtle, color: theme.dim)
            CRTText("Create a channel to start a multi-party room.",
                    style: .caption, glowIntensity: .none, color: theme.dim.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(CRTTheme.Spacing.xl)
    }
}

// MARK: - Create Channel Sheet

/// Minimal sheet to name and create a new channel.
private struct CreateChannelSheet: View {
    @Environment(\.crtTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    let onCreate: (String) -> Void
    @State private var title = ""

    private var canCreate: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: CRTTheme.Spacing.md) {
                CRTTextField("Channel name...", text: $title, icon: "number")
                    .padding(.horizontal, CRTTheme.Spacing.md)
                    .padding(.top, CRTTheme.Spacing.md)
                Spacer()
            }
            .background(theme.background.screen)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CRTText("NEW CHANNEL", style: .subheader, glowIntensity: .subtle)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(theme.primary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        onCreate(title)
                        dismiss()
                    }
                    .foregroundColor(canCreate ? theme.primary : theme.dim)
                    .disabled(!canCreate)
                }
            }
        }
    }
}
