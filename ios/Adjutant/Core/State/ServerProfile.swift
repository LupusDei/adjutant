//
//  ServerProfile.swift
//  Adjutant
//
//  Local, on-device storage for multiple Adjutant server connections so the user
//  can quickly switch between backends (adj-tur55). Each profile bundles a display
//  name + API base URL (UserDefaults) and an API key (Keychain). Nothing leaves
//  the device. Selecting a profile applies it to AppState (apiBaseURL + apiKey),
//  which already persists those and recreates the API client.
//

import Foundation
import Combine

/// A saved Adjutant server connection. The API key is NOT stored here — it lives
/// in the Keychain keyed by `id` (see `ServerProfileStore.apiKey(for:)`).
struct ServerProfile: Codable, Identifiable, Equatable, Hashable {
    let id: UUID
    var name: String
    /// Normalized API base URL string, e.g. "https://tunnel.ngrok.io/api".
    var baseURL: String

    init(id: UUID = UUID(), name: String, baseURL: String) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
    }

    var url: URL? { URL(string: baseURL) }
}

/// Singleton store for server profiles + the active selection.
@MainActor
final class ServerProfileStore: ObservableObject {
    static let shared = ServerProfileStore()

    @Published private(set) var profiles: [ServerProfile] = []
    @Published private(set) var activeID: UUID?

    private let profilesKey = "serverProfiles"
    private let activeKey = "activeServerProfileID"
    private let defaults = UserDefaults.standard

    private init() {
        load()
        migrateIfNeeded()
    }

    /// The currently-active profile, if any.
    var active: ServerProfile? {
        guard let activeID else { return nil }
        return profiles.first { $0.id == activeID }
    }

    /// The API key for a profile (read from the Keychain).
    func apiKey(for id: UUID) -> String {
        KeychainStore.get(id.uuidString) ?? ""
    }

    // MARK: - Mutations

    /// Create or update a profile from raw user input (URL is normalized, key
    /// stored in the Keychain). When `id` matches an existing profile it is
    /// updated in place. Returns the saved profile (nil if the URL is invalid).
    @discardableResult
    func upsert(id: UUID? = nil, name: String, rawURL: String, apiKey: String) -> ServerProfile? {
        guard let normalized = Self.normalize(rawURL) else { return nil }
        let resolvedID = id ?? UUID()
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalName = trimmedName.isEmpty ? (normalized.host ?? "Server") : trimmedName

        let profile = ServerProfile(id: resolvedID, name: finalName, baseURL: normalized.absoluteString)

        if let idx = profiles.firstIndex(where: { $0.id == resolvedID }) {
            profiles[idx] = profile
        } else {
            profiles.append(profile)
        }
        KeychainStore.set(apiKey.trimmingCharacters(in: .whitespacesAndNewlines), for: resolvedID.uuidString)
        persist()

        // First profile, or edited the active one → make it live.
        if activeID == nil || activeID == resolvedID {
            select(resolvedID)
        }
        return profile
    }

    /// Remove a profile (and its Keychain key). If active, fall back to the first.
    func delete(_ id: UUID) {
        profiles.removeAll { $0.id == id }
        KeychainStore.remove(id.uuidString)
        if activeID == id {
            activeID = nil
            if let first = profiles.first {
                select(first.id)
            } else {
                persist()
            }
        } else {
            persist()
        }
    }

    /// Make `id` the active server and apply it to `AppState`.
    func select(_ id: UUID) {
        guard let profile = profiles.first(where: { $0.id == id }), let url = profile.url else { return }
        activeID = id
        defaults.set(id.uuidString, forKey: activeKey)

        let key = apiKey(for: id)
        let app = AppState.shared
        app.apiBaseURL = url
        app.apiKey = key.isEmpty ? nil : key
    }

    // MARK: - Persistence

    private func persist() {
        if let data = try? JSONEncoder().encode(profiles) {
            defaults.set(data, forKey: profilesKey)
        }
        if let activeID {
            defaults.set(activeID.uuidString, forKey: activeKey)
        } else {
            defaults.removeObject(forKey: activeKey)
        }
    }

    private func load() {
        if let data = defaults.data(forKey: profilesKey),
           let decoded = try? JSONDecoder().decode([ServerProfile].self, from: data) {
            profiles = decoded
        }
        if let stored = defaults.string(forKey: activeKey), let id = UUID(uuidString: stored) {
            activeID = profiles.contains { $0.id == id } ? id : profiles.first?.id
        } else {
            activeID = profiles.first?.id
        }
    }

    /// On first run (no profiles yet) seed a "Default" profile from whatever the
    /// app is currently configured with, so existing users keep their connection.
    private func migrateIfNeeded() {
        guard profiles.isEmpty else { return }
        let app = AppState.shared
        let profile = ServerProfile(name: app.apiBaseURL.host ?? "Default", baseURL: app.apiBaseURL.absoluteString)
        profiles = [profile]
        activeID = profile.id
        KeychainStore.set(app.apiKey ?? "", for: profile.id.uuidString)
        persist()
    }

    // MARK: - URL normalization (mirrors OnboardingView/SettingsViewModel)

    /// Normalize a raw server URL: add https:// if missing, strip a trailing
    /// slash, and ensure it ends with `/api`.
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.hasPrefix("http://") && !s.hasPrefix("https://") {
            s = "https://" + s
        }
        if s.hasSuffix("/") {
            s = String(s.dropLast())
        }
        if !s.hasSuffix("/api") {
            s += "/api"
        }
        return URL(string: s)
    }
}
