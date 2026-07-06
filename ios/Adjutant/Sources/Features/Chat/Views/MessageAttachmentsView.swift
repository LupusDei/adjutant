import SwiftUI
import AdjutantKit

/// Renders a message's image attachments as inline thumbnails; tapping one opens
/// it full screen (adj-203.5.3). Images load through the authenticated client
/// (`GET /api/uploads/:id` is behind `apiKeyAuth`).
struct MessageAttachmentsView: View {
    @Environment(\.crtTheme) private var theme

    let attachments: [MessageAttachment]
    let apiClient: APIClient

    @State private var fullScreenAttachment: MessageAttachment?

    private let thumbnailSize: CGFloat = 160

    var body: some View {
        VStack(alignment: .leading, spacing: CRTTheme.Spacing.xxs) {
            ForEach(attachments) { attachment in
                Button {
                    fullScreenAttachment = attachment
                } label: {
                    AttachmentImageView(
                        attachmentId: attachment.id,
                        apiClient: apiClient,
                        contentMode: .fill
                    )
                    .frame(width: thumbnailSize, height: thumbnailSize)
                    .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg))
                    .overlay(
                        RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.lg)
                            .stroke(theme.dim.opacity(0.5), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Image attachment \(attachment.filename)")
                .accessibilityHint("Double tap to view full screen")
            }
        }
        .fullScreenCover(item: $fullScreenAttachment) { attachment in
            AttachmentFullScreenView(attachment: attachment, apiClient: apiClient)
        }
    }
}

/// Loads and renders a single attachment image via the authenticated client.
struct AttachmentImageView: View {
    @Environment(\.crtTheme) private var theme

    let attachmentId: String
    let apiClient: APIClient
    var contentMode: ContentMode = .fill

    @StateObject private var loader: AttachmentImageLoader

    init(attachmentId: String, apiClient: APIClient, contentMode: ContentMode = .fill) {
        self.attachmentId = attachmentId
        self.apiClient = apiClient
        self.contentMode = contentMode
        _loader = StateObject(wrappedValue: AttachmentImageLoader(apiClient: apiClient))
    }

    var body: some View {
        Group {
            switch loader.state {
            case .idle, .loading:
                ZStack {
                    theme.background.elevated
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: theme.dim))
                }
            case .loaded(let data):
                if let uiImage = UIImage(data: data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                } else {
                    failedView
                }
            case .failed:
                failedView
            }
        }
        .task(id: attachmentId) {
            await loader.load(attachmentId: attachmentId)
        }
    }

    private var failedView: some View {
        ZStack {
            theme.background.elevated
            Image(systemName: "photo.badge.exclamationmark")
                .font(.system(size: 24))
                .foregroundColor(theme.dim)
        }
    }
}

/// Full-screen, dismissible viewer for a single attachment image.
struct AttachmentFullScreenView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crtTheme) private var theme

    let attachment: MessageAttachment
    let apiClient: APIClient

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            AttachmentImageView(
                attachmentId: attachment.id,
                apiClient: apiClient,
                contentMode: .fit
            )
            .ignoresSafeArea()

            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 30))
                            .foregroundColor(.white.opacity(0.85))
                            .padding()
                    }
                    .accessibilityLabel("Close")
                }
                Spacer()
            }
        }
    }
}
