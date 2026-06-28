import Foundation

/// Pre-warms the Adjutant Bridge avatar session (adj-202.10).
///
/// Runway takes ~3-5s to provision an avatar session, which is the Bridge's load-time floor.
/// When the Commander enables "Pre-warm Avatar" in Settings, the app pings the backend's
/// `POST /avatar/prepare` whenever it enters the foreground, so a tool-enabled session is
/// already READY by the time LIVE is tapped (~2s to first frame instead of ~5s). The backend
/// only warms on this explicit signal (never speculatively), so credits are spent only around
/// real intent, and the daily cost-guard ceiling still gates every session.
///
/// Fire-and-forget: the request is non-blocking and failures are intentionally ignored — a
/// missed warm just means the next connect falls back to on-demand provisioning.
public enum BridgePrewarmer {
    /// UserDefaults key shared with SettingsViewModel's `prewarmBridgeEnabled` toggle.
    public static let userDefaultsKey = "prewarmBridgeEnabled"

    public static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: userDefaultsKey)
    }

    /// If pre-warm is enabled, kick off a background `POST /avatar/prepare`. Non-blocking.
    @MainActor
    public static func prepareIfEnabled() {
        guard isEnabled, let url = prepareURL() else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("{}".utf8)
        req.timeoutInterval = 10
        URLSession.shared.dataTask(with: req).resume()
    }

    /// The avatar endpoints live at the ORIGIN root, so strip the API path from apiBaseURL.
    @MainActor
    private static func prepareURL() -> URL? {
        guard var components = URLComponents(url: AppState.shared.apiBaseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = "/avatar/prepare"
        components.query = nil
        return components.url
    }
}
