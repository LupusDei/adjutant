import SwiftUI
import PhotosUI

/// Input area for composing chat messages with text, image attachments, and
/// voice options.
struct ChatInputView: View {
    @Environment(\.crtTheme) private var theme
    @FocusState private var isTextFieldFocused: Bool

    @Binding var text: String
    let recipientName: String
    let isRecordingVoice: Bool
    let canSend: Bool
    let onSend: () -> Void
    let onVoiceToggle: () -> Void

    /// Staged image attachments (adj-203). Optional so existing previews /
    /// call sites without attachment support keep compiling.
    @ObservedObject var attachments: ComposerAttachments = ComposerAttachments()

    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            // Staged image thumbnails (only shown when non-empty).
            AttachmentPreviewStrip(attachments: attachments)

            HStack(spacing: CRTTheme.Spacing.xs) {
                // Attach image (PhotosPicker) + paste
                attachButton

                // Voice input button
                voiceButton

                // Text input
                textInput

                // Send button
                sendButton
            }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            Rectangle()
                .fill(theme.background.panel)
                .overlay(
                    Rectangle()
                        .frame(height: 1)
                        .foregroundColor(theme.dim.opacity(0.3)),
                    alignment: .top
                )
        )
        .onChange(of: photoItem) { _, newItem in
            guard let newItem else { return }
            Task { await stage(from: newItem) }
        }
    }

    // MARK: - Attachment intake

    private var attachButton: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            PhotosPicker(selection: $photoItem, matching: .images, photoLibrary: .shared()) {
                Image(systemName: "photo.on.rectangle")
                    .font(.system(size: 20))
                    .foregroundColor(attachments.canAddMore ? theme.primary : theme.dim.opacity(0.4))
                    .frame(width: 36, height: 44)
            }
            .disabled(!attachments.canAddMore)
            .accessibilityLabel("Attach image")

            Button(action: pasteImage) {
                Image(systemName: "doc.on.clipboard")
                    .font(.system(size: 18))
                    .foregroundColor(attachments.canAddMore ? theme.primary : theme.dim.opacity(0.4))
                    .frame(width: 30, height: 44)
            }
            .buttonStyle(.plain)
            .disabled(!attachments.canAddMore)
            .accessibilityLabel("Paste image")
        }
    }

    /// Load a picked photo's bytes, sniff its MIME, and stage it.
    private func stage(from item: PhotosPickerItem) async {
        defer { photoItem = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        stage(data: data)
    }

    /// Paste an image from the system clipboard, if present.
    private func pasteImage() {
        if let image = UIPasteboard.general.image, let data = image.pngData() {
            stage(data: data, fallbackMime: "image/png")
        }
    }

    private func stage(data: Data, fallbackMime: String? = nil) {
        let mime = ImageMimeSniffer.mimeType(for: data) ?? fallbackMime
        guard let mimeType = mime else { return }
        _ = attachments.add(
            PendingAttachment(
                data: data,
                filename: ImageMimeSniffer.filename(for: mimeType),
                mimeType: mimeType
            )
        )
    }

    // MARK: - Subviews

    private var voiceButton: some View {
        Button(action: onVoiceToggle) {
            Image(systemName: isRecordingVoice ? "mic.fill" : "mic")
                .font(.system(size: 20))
                .foregroundColor(isRecordingVoice ? CRTTheme.State.error : theme.primary)
                .frame(width: 44, height: 44)
                .background(
                    Circle()
                        .fill(isRecordingVoice ? CRTTheme.State.error.opacity(0.2) : Color.clear)
                )
                .overlay(
                    Circle()
                        .stroke(
                            isRecordingVoice ? CRTTheme.State.error : theme.dim.opacity(0.5),
                            lineWidth: 1
                        )
                )
        }
        .buttonStyle(.plain)
        .crtGlow(
            color: isRecordingVoice ? CRTTheme.State.error : theme.primary,
            radius: isRecordingVoice ? 8 : 0,
            intensity: isRecordingVoice ? 0.4 : 0
        )
        .animation(.easeInOut(duration: 0.2), value: isRecordingVoice)
        .accessibilityLabel(isRecordingVoice ? "Stop recording" : "Start voice input")
    }

    private var textInput: some View {
        HStack(spacing: CRTTheme.Spacing.xxs) {
            TextField("", text: $text, prompt: promptText, axis: .vertical)
                .font(CRTTheme.Typography.font(size: 14))
                .foregroundColor(theme.primary)
                .tint(theme.primary)
                .focused($isTextFieldFocused)
                .lineLimit(1...4)
                .onSubmit {
                    if canSend {
                        onSend()
                    }
                }
        }
        .padding(.horizontal, CRTTheme.Spacing.sm)
        .padding(.vertical, CRTTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .fill(theme.background.elevated.opacity(isTextFieldFocused ? 0.8 : 0.5))
        )
        .overlay(
            RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                .stroke(
                    isTextFieldFocused ? theme.primary : theme.dim.opacity(0.3),
                    lineWidth: isTextFieldFocused ? 2 : 1
                )
        )
        .crtGlow(
            color: theme.primary,
            radius: isTextFieldFocused ? 4 : 0,
            intensity: isTextFieldFocused ? 0.2 : 0
        )
        .animation(.easeInOut(duration: 0.1), value: isTextFieldFocused)
        .accessibilityLabel("Message input")
    }

    private var sendButton: some View {
        Button(action: onSend) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 32))
                .foregroundColor(canSend ? theme.primary : theme.dim.opacity(0.3))
        }
        .buttonStyle(.plain)
        .disabled(!canSend)
        .crtGlow(
            color: theme.primary,
            radius: canSend ? 6 : 0,
            intensity: canSend ? 0.4 : 0
        )
        .animation(.easeInOut(duration: 0.15), value: canSend)
        .accessibilityLabel("Send message")
        .accessibilityHint(canSend ? "Double tap to send" : "Enter a message first")
    }

    private var promptText: Text {
        Text("MESSAGE \(recipientName)...")
            .foregroundColor(theme.dim.opacity(0.5))
    }
}

// MARK: - Preview

#Preview("ChatInputView") {
    struct PreviewWrapper: View {
        @State private var text = ""
        @State private var isRecording = false

        var body: some View {
            VStack {
                Spacer()
                ChatInputView(
                    text: $text,
                    recipientName: "SYSTEM",
                    isRecordingVoice: isRecording,
                    canSend: !text.isEmpty,
                    onSend: { text = "" },
                    onVoiceToggle: { isRecording.toggle() }
                )
            }
            .background(CRTTheme.ColorTheme.pipboy.background.screen)
        }
    }

    return PreviewWrapper()
}

#Preview("ChatInputView with Text") {
    struct PreviewWrapper: View {
        @State private var text = "Hello, I have a question"
        @State private var isRecording = false

        var body: some View {
            VStack {
                Spacer()
                ChatInputView(
                    text: $text,
                    recipientName: "STUKOV",
                    isRecordingVoice: isRecording,
                    canSend: !text.isEmpty,
                    onSend: { },
                    onVoiceToggle: { }
                )
            }
            .background(CRTTheme.ColorTheme.pipboy.background.screen)
        }
    }

    return PreviewWrapper()
}
