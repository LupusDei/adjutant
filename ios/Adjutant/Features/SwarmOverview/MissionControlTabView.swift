import SwiftUI
import AdjutantKit

/// The Mission Control tab: the native map (adj-208) + the per-feature intensity render (adj-209.4)
/// + the project selector filter (adj-209.3), extracted from `SwarmOverviewView` into a
/// self-contained view (adj-209.3.2.1).
///
/// Extraction serves two goals: it decouples the Mission Control feature from the large Swarm
/// summary screen (a change here can't ripple into the dashboard), and it makes the
/// View↔ViewModel integration typecheckable in isolation — which is exactly the gap that let a
/// wrong VM API ship. It binds ONLY to `MissionControlViewModel`'s real, tested API
/// (`visibleProjects`, `selectedProjectIds`, `allProjects`, `selectAll`/`deselectAll`/`toggleProject`).
struct MissionControlTabView: View {
    @ObservedObject var viewModel: MissionControlViewModel
    @Environment(\.crtTheme) private var theme

    @State private var showingProjectFilter = false

    var body: some View {
        VStack(spacing: 0) {
            filterBar
            GeometryReader { geo in
                ScrollView {
                    map(height: max(geo.size.height, 480))
                        .frame(width: geo.size.width)
                }
                .refreshable {
                    await viewModel.refresh()
                    await viewModel.loadAllProjects()
                }
            }
        }
        .onAppear { viewModel.onAppear() }
        .onDisappear { viewModel.onDisappear() }
        .sheet(isPresented: $showingProjectFilter) {
            // Decoupled selector: pure model in, closures out. The VM owns/persists the selection
            // and re-fetches with the derived projectIds; this view stays stateless.
            MissionControlSelectorView(
                model: selectorModel,
                onSelectAll: { apply { viewModel.selectAll() } },
                onDeselectAll: { apply { viewModel.deselectAll() } },
                onToggle: { id in apply { viewModel.toggleProject(id) } },
                onDone: { showingProjectFilter = false }
            )
            .presentationDetents([.medium, .large])
            .onAppear { Task { await viewModel.loadAllProjects() } }  // freshest universe when opening
        }
    }

    /// The selector's pure presenter, built from the FULL project universe (not the filtered map
    /// rollup) and the VM's `selectedProjectIds` (nil == all).
    private var selectorModel: MissionControlSelectorModel {
        MissionControlSelectorModel(
            projects: viewModel.allProjects.map { MissionControlSelectorModel.Project(id: $0.id, name: $0.name) },
            selectedIds: viewModel.selectedProjectIds
        )
    }

    /// Mutate the selection, persist (handled by the VM), then re-fetch so the map reflects the new
    /// filter — including pulling in a project that was just re-enabled (its rollup data isn't in the
    /// currently-filtered response).
    private func apply(_ mutate: () -> Void) {
        mutate()
        Task { await viewModel.refresh() }
    }

    // MARK: - Filter bar

    @ViewBuilder
    private var filterBar: some View {
        if !viewModel.allProjects.isEmpty {
            HStack {
                Spacer()
                Button {
                    showingProjectFilter = true
                } label: {
                    HStack(spacing: CRTTheme.Spacing.xs) {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                            .font(.system(size: 13, weight: .semibold))
                        CRTText(selectorModel.summary, style: .caption, color: CRTTheme.Brand.cyanText)
                    }
                    .foregroundColor(CRTTheme.Brand.cyanText)
                    .padding(.horizontal, CRTTheme.Spacing.sm)
                    .padding(.vertical, CRTTheme.Spacing.xs)
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.sm)
                            .stroke(CRTTheme.Brand.cyan.opacity(0.6), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Filter projects. \(selectorModel.summary)")
            }
            .padding(.horizontal, CRTTheme.Spacing.md)
            .padding(.vertical, CRTTheme.Spacing.sm)
        }
    }

    // MARK: - Map / loading / error

    @ViewBuilder
    private func map(height: CGFloat) -> some View {
        if let rollup = viewModel.rollup {
            // Render the CLIENT-filtered projects (so a just-toggled selection is honored
            // immediately); totals come from the server's filtered rollup.
            MissionControlMapView(projects: viewModel.visibleProjects, totals: rollup.totals)
                .frame(height: height)
        } else {
            switch viewModel.state {
            case .error(let message):
                errorView(message).frame(height: height)
            default:  // .loading (or the impossible loaded-without-rollup) → spinner
                loadingView.frame(height: height)
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: theme.primary))
                .scaleEffect(1.3)
            CRTText("LOADING MISSION CONTROL...", style: .caption, color: theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: CRTTheme.Spacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundColor(CRTTheme.State.warning)
            CRTText("MISSION CONTROL UNAVAILABLE", style: .subheader, color: CRTTheme.State.warning)
            CRTText(message, style: .caption, color: theme.dim)
                .multilineTextAlignment(.center)
            CRTButton("RETRY", variant: .secondary, size: .medium) {
                Task<Void, Never> { await viewModel.refresh() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(CRTTheme.Spacing.lg)
    }
}
