//
//  ServerProfilesView.swift
//  Adjutant
//
//  Manage saved Adjutant servers (adj-tur55): list, switch active, add/edit/delete.
//  Credentials (URL + API key) are entered here; the key is stored in the Keychain,
//  the rest in UserDefaults. Reached from Settings → ADJUTANT SERVERS → MANAGE.
//

import SwiftUI

struct ServerProfilesView: View {
    @ObservedObject private var store = ServerProfileStore.shared
    @Environment(\.crtTheme) private var theme

    @State private var showingAdd = false
    @State private var editing: ServerProfile?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                CRTText("ADJUTANT SERVERS", style: .header, color: theme.primary)
                CRTText(
                    "Saved locally on this device. Tap a server to switch the app's backend.",
                    style: .caption,
                    color: theme.dim
                )

                ForEach(store.profiles) { profile in
                    row(profile)
                }

                if store.profiles.isEmpty {
                    CRTText("NO SERVERS SAVED", style: .caption, color: theme.dim)
                        .padding(.vertical, CRTTheme.Spacing.md)
                }

                CRTButton("+ ADD SERVER", variant: .secondary, size: .medium) {
                    showingAdd = true
                }
                .padding(.top, CRTTheme.Spacing.sm)
            }
            .padding(CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
        .sheet(isPresented: $showingAdd) {
            ServerProfileEditorView(existing: nil)
        }
        .sheet(item: $editing) { profile in
            ServerProfileEditorView(existing: profile)
        }
    }

    @ViewBuilder
    private func row(_ profile: ServerProfile) -> some View {
        let isActive = store.activeID == profile.id
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            HStack(spacing: CRTTheme.Spacing.sm) {
                Image(systemName: isActive ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isActive ? theme.primary : theme.dim)
                    .font(.system(size: 14))
                CRTText(profile.name.uppercased(), style: .body, color: theme.primary)
                Spacer()
                if isActive {
                    CRTText("ACTIVE", style: .caption, color: theme.primary)
                }
            }
            CRTText(profile.baseURL, style: .caption, color: theme.dim)
                .lineLimit(1)
                .truncationMode(.middle)

            HStack(spacing: CRTTheme.Spacing.md) {
                if !isActive {
                    Button { store.select(profile.id) } label: {
                        CRTText("SWITCH TO", style: .caption, color: theme.primary)
                    }
                }
                Button { editing = profile } label: {
                    CRTText("EDIT", style: .caption, color: theme.dim)
                }
                Button { store.delete(profile.id) } label: {
                    CRTText("DELETE", style: .caption, color: CRTTheme.State.error)
                }
            }
            .padding(.top, CRTTheme.Spacing.xs)
        }
        .padding(CRTTheme.Spacing.sm)
        .background(theme.background.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 2)
                .stroke(isActive ? theme.primary.opacity(0.6) : theme.dim.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Editor

/// Add or edit a single server profile (name + URL + API key).
private struct ServerProfileEditorView: View {
    let existing: ServerProfile?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.crtTheme) private var theme

    @State private var name = ""
    @State private var urlText = ""
    @State private var apiKey = ""
    @State private var errorMessage: String?

    private var isEditing: Bool { existing != nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CRTTheme.Spacing.md) {
                CRTText(isEditing ? "EDIT SERVER" : "ADD SERVER", style: .header, color: theme.primary)

                field(label: "NAME", placeholder: "Production / Staging / …", text: $name, secure: false, url: false)
                field(label: "SERVER URL", placeholder: "https://your-tunnel.ngrok.io", text: $urlText, secure: false, url: true)
                field(label: "API KEY", placeholder: "adj_…", text: $apiKey, secure: true, url: false)

                if let errorMessage {
                    CRTText(errorMessage, style: .caption, color: CRTTheme.State.error)
                }

                HStack(spacing: CRTTheme.Spacing.md) {
                    CRTButton("SAVE", variant: .primary, size: .medium) { save() }
                        .disabled(urlText.trimmingCharacters(in: .whitespaces).isEmpty)
                    CRTButton("CANCEL", variant: .secondary, size: .medium) { dismiss() }
                }
                .padding(.top, CRTTheme.Spacing.sm)
            }
            .padding(CRTTheme.Spacing.md)
        }
        .background(theme.background.screen)
        .onAppear(perform: prefill)
    }

    @ViewBuilder
    private func field(label: String, placeholder: String, text: Binding<String>, secure: Bool, url: Bool) -> some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xs) {
            CRTText(label, style: .caption, color: theme.dim)
            Group {
                if secure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                        .keyboardType(url ? .URL : .default)
                        .textContentType(url ? .URL : nil)
                }
            }
            .font(.system(size: 14, design: .monospaced))
            .foregroundColor(theme.primary)
            .tint(theme.primary)
            .autocorrectionDisabled(true)
            .textInputAutocapitalization(.never)
            .padding(CRTTheme.Spacing.sm)
            .background(theme.background.panel)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(theme.dim.opacity(0.5), lineWidth: 1)
            )
        }
    }

    private func prefill() {
        guard let existing else { return }
        name = existing.name
        urlText = existing.baseURL
        apiKey = ServerProfileStore.shared.apiKey(for: existing.id)
    }

    private func save() {
        guard ServerProfileStore.normalize(urlText) != nil else {
            errorMessage = "Enter a valid server URL."
            return
        }
        ServerProfileStore.shared.upsert(
            id: existing?.id,
            name: name,
            rawURL: urlText,
            apiKey: apiKey
        )
        dismiss()
    }
}
