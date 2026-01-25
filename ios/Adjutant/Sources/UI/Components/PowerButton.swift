#if canImport(UIKit)
import UIKit
#endif
import SwiftUI
import Combine
import AdjutantKit

// MARK: - PowerButton

/// A toggle switch control for Gastown power state.
///
/// Displays current power state with ON/OFF track labels and handles
/// power up/down API calls. Disabled during state transitions.
///
/// ## Example Usage
/// ```swift
/// PowerButton()
///
/// PowerButton()
///     .crtTheme(.blue)
/// ```
public struct PowerButton: View {
    @Environment(\.crtTheme) private var theme
    @StateObject private var viewModel = PowerButtonViewModel()
    @State private var isPressed = false

    public init() {}

    public var body: some View {
        Button(action: handleTap) {
            HStack(spacing: CRTTheme.Spacing.xs) {
                // TOWN label
                CRTText("TOWN", style: .caption, glowIntensity: labelGlow, color: labelColor)

                // Toggle track with ON/OFF labels
                toggleTrack
            }
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isDisabled)
        .opacity(viewModel.isDisabled ? 0.7 : 1.0)
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !viewModel.isDisabled else { return }
                    withAnimation(CRTTheme.Animation.buttonPress) {
                        isPressed = true
                    }
                }
                .onEnded { _ in
                    withAnimation(CRTTheme.Animation.buttonPress) {
                        isPressed = false
                    }
                }
        )
        .accessibilityLabel("Town Power")
        .accessibilityValue(accessibilityValue)
        .accessibilityHint(accessibilityHint)
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Toggle Track

    private var toggleTrack: some View {
        ZStack {
            // Track background
            RoundedRectangle(cornerRadius: 14)
                .fill(trackBackgroundColor)
                .frame(width: 72, height: 28)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(trackBorderColor, lineWidth: 1)
                )

            // Track labels
            HStack {
                // OFF label
                Text("OFF")
                    .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                    .tracking(0.5)
                    .foregroundColor(viewModel.powerState == .stopped ? theme.dim : theme.dim.opacity(0.3))
                    .frame(width: 28)

                Spacer()

                // ON label
                Text("ON")
                    .font(CRTTheme.Typography.font(size: 9, weight: .bold))
                    .tracking(0.5)
                    .foregroundColor(viewModel.powerState == .running ? theme.primary : theme.dim.opacity(0.3))
                    .frame(width: 28)
            }
            .padding(.horizontal, 4)
            .frame(width: 72)

            // Knob
            knobView
                .offset(x: knobOffset)
        }
        .scaleEffect(isPressed ? 0.95 : 1.0)
        .crtGlow(color: glowColor, radius: glowRadius, intensity: glowIntensity)
    }

    // MARK: - Knob

    @ViewBuilder
    private var knobView: some View {
        ZStack {
            // Knob shape
            Circle()
                .fill(knobColor)
                .frame(width: 22, height: 22)

            // State indicator
            stateIndicator
        }
    }

    @ViewBuilder
    private var stateIndicator: some View {
        switch viewModel.powerState {
        case .running:
            // Glowing dot for running state
            Circle()
                .fill(theme.primary)
                .frame(width: 8, height: 8)
                .crtGlow(color: theme.primary, radius: 4, intensity: 0.8)
        case .stopped:
            // Empty - off state
            EmptyView()
        case .starting, .stopping:
            // Spinning indicator for transitions
            TransitionIndicator()
        }
    }

    // MARK: - Styling

    private var knobOffset: CGFloat {
        switch viewModel.powerState {
        case .stopped: return -22
        case .running: return 22
        case .starting: return 0  // Center during transition
        case .stopping: return 0
        }
    }

    private var trackBackgroundColor: Color {
        switch viewModel.powerState {
        case .running:
            return theme.primary.opacity(0.2)
        case .starting, .stopping:
            return CRTTheme.State.warning.opacity(0.15)
        case .stopped:
            return theme.dim.opacity(0.15)
        }
    }

    private var trackBorderColor: Color {
        switch viewModel.powerState {
        case .running:
            return theme.primary.opacity(0.5)
        case .starting, .stopping:
            return CRTTheme.State.warning.opacity(0.5)
        case .stopped:
            return theme.dim.opacity(0.3)
        }
    }

    private var knobColor: Color {
        switch viewModel.powerState {
        case .running:
            return theme.primary
        case .starting, .stopping:
            return CRTTheme.State.warning
        case .stopped:
            return theme.dim
        }
    }

    private var labelColor: Color {
        viewModel.powerState == .running ? theme.primary : theme.dim
    }

    private var labelGlow: CRTText.GlowIntensity {
        viewModel.powerState == .running ? .medium : .none
    }

    private var glowColor: Color {
        switch viewModel.powerState {
        case .running: return theme.primary
        case .starting, .stopping: return CRTTheme.State.warning
        case .stopped: return .clear
        }
    }

    private var glowRadius: CGFloat {
        viewModel.powerState == .running ? 8 : 4
    }

    private var glowIntensity: Double {
        switch viewModel.powerState {
        case .running: return 0.5
        case .starting, .stopping: return 0.3
        case .stopped: return 0
        }
    }

    // MARK: - Accessibility

    private var accessibilityValue: String {
        switch viewModel.powerState {
        case .running: return "On, running"
        case .stopped: return "Off, stopped"
        case .starting: return "Starting"
        case .stopping: return "Stopping"
        }
    }

    private var accessibilityHint: String {
        if viewModel.isDisabled {
            return "Power state is changing"
        }
        return viewModel.powerState == .running
            ? "Double tap to stop"
            : "Double tap to start"
    }

    // MARK: - Actions

    private func handleTap() {
        guard !viewModel.isDisabled else { return }

        // Haptic feedback
        #if canImport(UIKit)
        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
        impactFeedback.impactOccurred()
        #endif

        Task {
            await viewModel.togglePower()
        }
    }
}

// MARK: - TransitionIndicator

/// A small spinning indicator for power state transitions.
private struct TransitionIndicator: View {
    @State private var isAnimating = false

    var body: some View {
        Circle()
            .trim(from: 0, to: 0.6)
            .stroke(CRTTheme.State.warning, lineWidth: 2)
            .frame(width: 10, height: 10)
            .rotationEffect(.degrees(isAnimating ? 360 : 0))
            .animation(
                .linear(duration: 0.8).repeatForever(autoreverses: false),
                value: isAnimating
            )
            .onAppear {
                isAnimating = true
            }
    }
}

// MARK: - PowerButtonViewModel

/// ViewModel for PowerButton that manages power state and API interactions.
@MainActor
final class PowerButtonViewModel: ObservableObject {
    @Published private(set) var powerState: PowerState = .stopped
    @Published private(set) var isOperating: Bool = false

    var isDisabled: Bool {
        isOperating || powerState.isTransitioning
    }

    private let apiClient: APIClient
    private var cancellables = Set<AnyCancellable>()

    init(apiClient: APIClient = APIClient()) {
        self.apiClient = apiClient
        setupBindings()
    }

    private func setupBindings() {
        // Observe global power state
        AppState.shared.$powerState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                self?.powerState = state
            }
            .store(in: &cancellables)
    }

    func togglePower() async {
        guard !isDisabled else { return }

        isOperating = true

        do {
            if powerState == .running {
                // Power down
                AppState.shared.updatePowerState(.stopping)
                let response = try await apiClient.powerDown()
                AppState.shared.updatePowerState(convertPowerState(response.newState))
            } else {
                // Power up
                AppState.shared.updatePowerState(.starting)
                let response = try await apiClient.powerUp()
                AppState.shared.updatePowerState(convertPowerState(response.newState))
            }
        } catch {
            // On error, revert to stopped state
            AppState.shared.updatePowerState(.stopped)
            APILogger.shared.logError(error, context: "PowerButton toggle")
        }

        isOperating = false
    }

    /// Converts AdjutantKit PowerState to local PowerState
    private func convertPowerState(_ state: AdjutantKit.PowerState) -> PowerState {
        switch state {
        case .stopped: return .stopped
        case .starting: return .starting
        case .running: return .running
        case .stopping: return .stopping
        }
    }
}

// MARK: - Preview

#Preview("PowerButton States") {
    VStack(spacing: 24) {
        PowerButton()

        // Show different states via preview
        Text("Preview different states by toggling")
            .font(.caption)
            .foregroundColor(.gray)
    }
    .padding()
    .background(CRTTheme.Background.screen)
}

#Preview("PowerButton Themes") {
    HStack(spacing: 16) {
        ForEach(CRTTheme.ColorTheme.allCases) { theme in
            PowerButton()
                .crtTheme(theme)
        }
    }
    .padding()
    .background(CRTTheme.Background.screen)
}
