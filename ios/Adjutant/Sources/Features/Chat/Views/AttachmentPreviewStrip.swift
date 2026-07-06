import SwiftUI

/// Horizontal strip of staged (not-yet-sent) image thumbnails with a remove
/// control on each (adj-203.5.2). Shown above the input row while the composer
/// holds ≥1 attachment.
struct AttachmentPreviewStrip: View {
    @Environment(\.crtTheme) private var theme
    @ObservedObject var attachments: ComposerAttachments

    private let thumbSize: CGFloat = 56

    var body: some View {
        if !attachments.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: CRTTheme.Spacing.xs) {
                    ForEach(attachments.items) { item in
                        thumbnail(for: item)
                    }
                }
                .padding(.horizontal, CRTTheme.Spacing.sm)
                .padding(.vertical, CRTTheme.Spacing.xs)
            }
        }
    }

    @ViewBuilder
    private func thumbnail(for item: PendingAttachment) -> some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let uiImage = UIImage(data: item.data) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                } else {
                    theme.background.elevated
                }
            }
            .frame(width: thumbSize, height: thumbSize)
            .clipShape(RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: CRTTheme.CornerRadius.md)
                    .stroke(theme.dim.opacity(0.5), lineWidth: 1)
            )

            Button {
                attachments.remove(id: item.id)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundColor(.white)
                    .background(Circle().fill(Color.black.opacity(0.6)))
            }
            .buttonStyle(.plain)
            .offset(x: 6, y: -6)
            .accessibilityLabel("Remove attachment")
        }
    }
}
