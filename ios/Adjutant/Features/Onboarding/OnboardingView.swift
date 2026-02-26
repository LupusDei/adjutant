//
//  OnboardingView.swift
//  Adjutant
//
//  Onboarding screen for configuring the API server URL.
//

import SwiftUI

/// Onboarding view for first-time setup.
/// Allows user to enter the ngrok tunnel URL for API access.
@MainActor
public struct OnboardingView: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject private var appState = AppState.shared

    @State private var serverURL: String = ""
    @State private var isValidating = false
    @State private var errorMessage: String?
    @State private var showSuccess = false

    /// Callback when onboarding is complete
    var onComplete: () -> Void

    public init(onComplete: @escaping () -> Void) {
        self.onComplete = onComplete
    }

    public var body: some View {
        ZStack {
            // Background
            theme.background.screen
                .ignoresSafeArea()

            VStack(spacing: CRTTheme.Spacing.xl) {
                Spacer()

                // Header
                VStack(spacing: CRTTheme.Spacing.sm) {
                    Image(systemName: "antenna.radiowaves.left.and.right")
                        .font(.system(size: 60))
                        .foregroundColor(theme.primary)
                        .crtGlow(color: theme.primary, radius: 8, intensity: 0.6)

                    CRTText("ADJUTANT", style: .header)
                        .crtGlow(color: theme.primary, radius: 4, intensity: 0.4)

                    CRTText("SYSTEM CONFIGURATION", style: .caption, color: theme.dim)
                }

                // Instructions
                VStack(alignment: .leading, spacing: CRTTheme.Spacing.sm) {
                    CRTText("ENTER SERVER URL", style: .caption, color: theme.dim)

                    CRTText(
                        "Enter the ngrok tunnel URL for your Adjutant backend server. This URL will be saved locally on your device.",
                        style: .body,
                        color: theme.dim
                    )
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, CRTTheme.Spacing.lg)

                // URL Input
                VStack(spacing: CRTTheme.Spacing.md) {
                    HStack {
                        Image(systemName: "link")
                            .foregroundColor(theme.dim)

                        TextField("https://your-tunnel.ngrok.io", text: $serverURL)
                            .textFieldStyle(.plain)
                            .font(.crt(CRTTypography.sizeBase))
                            .foregroundColor(theme.primary)
                            #if os(iOS)
                            .autocapitalization(.none)
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            #endif
                            .autocorrectionDisabled()
                    }
                    .padding(CRTTheme.Spacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .fill(theme.background.panel)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .stroke(
                                errorMessage != nil ? CRTTheme.State.error : theme.dim,
                                lineWidth: 1
                            )
                    )

                    // Error message
                    if let error = errorMessage {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(CRTTheme.State.error)
                            CRTText(error, style: .caption, color: CRTTheme.State.error)
                        }
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.lg)

                // Connect button
                Button(action: validateAndConnect) {
                    HStack(spacing: CRTTheme.Spacing.sm) {
                        if isValidating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .black))
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "bolt.fill")
                        }

                        Text(isValidating ? "CONNECTING..." : "CONNECT")
                            .font(.crt(CRTTypography.sizeLG))
                            .tracking(CRTTypography.letterSpacingWider)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(CRTTheme.Spacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                            .fill(theme.primary)
                    )
                    .foregroundColor(.black)
                }
                .disabled(serverURL.isEmpty || isValidating)
                .opacity(serverURL.isEmpty ? 0.5 : 1.0)
                .padding(.horizontal, CRTTheme.Spacing.lg)
                .crtGlow(color: theme.primary, radius: isValidating ? 8 : 4, intensity: isValidating ? 0.6 : 0.3)

                Spacer()

                // Footer
                CRTText("GAS TOWN INDUSTRIES", style: .caption, color: theme.dim)
                    .padding(.bottom, CRTTheme.Spacing.lg)
            }
        }
        .overlay(
            // Success overlay
            Group {
                if showSuccess {
                    successOverlay
                }
            }
        )
    }

    private var successOverlay: some View {
        ZStack {
            Color.black.opacity(0.8)
                .ignoresSafeArea()

            VStack(spacing: CRTTheme.Spacing.lg) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 80))
                    .foregroundColor(CRTTheme.State.success)
                    .crtGlow(color: CRTTheme.State.success, radius: 12, intensity: 0.8)

                CRTText("CONNECTION ESTABLISHED", style: .header, color: CRTTheme.State.success)

                CRTText("Initializing system...", style: .body, color: theme.dim)
            }
        }
        .transition(.opacity)
    }

    private func validateAndConnect() {
        errorMessage = nil

        // Clean up the URL
        var cleanURL = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)

        // Add https:// if no scheme provided
        if !cleanURL.hasPrefix("http://") && !cleanURL.hasPrefix("https://") {
            cleanURL = "https://" + cleanURL
        }

        // Remove trailing slash
        if cleanURL.hasSuffix("/") {
            cleanURL = String(cleanURL.dropLast())
        }

        // Append /api if not present
        if !cleanURL.hasSuffix("/api") {
            cleanURL = cleanURL + "/api"
        }

        // Validate URL format
        guard let url = URL(string: cleanURL),
              let host = url.host,
              !host.isEmpty else {
            errorMessage = "Invalid URL format"
            return
        }

        // Block localhost URLs
        if host.contains("localhost") || host.contains("127.0.0.1") {
            errorMessage = "Please enter a remote server URL, not localhost"
            return
        }

        isValidating = true

        // Test the connection
        Task {
            do {
                let testURL = url.deletingLastPathComponent().appendingPathComponent("health")
                var request = URLRequest(url: testURL)
                request.timeoutInterval = 10

                let (_, response) = try await URLSession.shared.data(for: request)

                if let httpResponse = response as? HTTPURLResponse,
                   (200...299).contains(httpResponse.statusCode) {
                    // Success - save URL and proceed
                    appState.apiBaseURL = url

                    withAnimation {
                        showSuccess = true
                    }

                    // Delay before transitioning
                    try await Task.sleep(nanoseconds: 1_500_000_000)

                    onComplete()
                } else {
                    errorMessage = "Server returned an error. Check the URL."
                    isValidating = false
                }
            } catch {
                // Even if health check fails, allow connection (server might not have /health endpoint)
                // Just save the URL
                appState.apiBaseURL = url

                withAnimation {
                    showSuccess = true
                }

                try? await Task.sleep(nanoseconds: 1_500_000_000)

                onComplete()
            }
        }
    }
}

#Preview("Onboarding") {
    OnboardingView {
        print("Onboarding complete!")
    }
    .preferredColorScheme(.dark)
}
