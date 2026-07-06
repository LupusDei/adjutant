import Foundation
import Combine
import AdjutantKit

/// Loads a message image attachment's bytes through the **authenticated** API
/// client (adj-203.5.3), backed by a process-wide in-memory cache keyed by
/// attachment id (adj-203.5.6).
///
/// `GET /api/uploads/:id` is behind `apiKeyAuth`, so a bare `AsyncImage(url:)`
/// (which cannot attach the Bearer header) 401s. This loader delegates to
/// ``APIClient/fetchUploadData(id:)`` so the same auth header used for every
/// other API call is sent, and exposes a simple state machine the view binds to.
///
/// Attachment ids are server-generated and immutable, so bytes are cached by id:
/// re-rendering a thumbnail (scroll-into-view) or opening the full screen reuses
/// the already-downloaded bytes instead of re-fetching.
@MainActor
final class AttachmentImageLoader: ObservableObject {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded(Data)
        case failed(String)
    }

    @Published private(set) var state: LoadState = .idle

    private let apiClient: APIClient

    /// Process-wide image byte cache, keyed by attachment id. `NSCache` is
    /// thread-safe and evicts under memory pressure.
    private static let cache: NSCache<NSString, NSData> = {
        let c = NSCache<NSString, NSData>()
        // Cap total cached bytes (~48 MB) so a long session can't grow unbounded.
        c.totalCostLimit = 48 * 1024 * 1024
        return c
    }()

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    /// Fetch the attachment bytes (authenticated), serving from the cache when
    /// present. Re-entry restarts the load.
    func load(attachmentId: String) async {
        if let cached = Self.cachedData(for: attachmentId) {
            state = .loaded(cached)
            return
        }
        state = .loading
        do {
            let data = try await apiClient.fetchUploadData(id: attachmentId)
            Self.store(data, for: attachmentId)
            state = .loaded(data)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    // MARK: - Cache

    /// Seed the cache with locally-available bytes for an id — used to show a
    /// just-sent (optimistic) image immediately without a round-trip (adj-203.5.7).
    static func prime(attachmentId: String, data: Data) {
        store(data, for: attachmentId)
    }

    static func cachedData(for attachmentId: String) -> Data? {
        cache.object(forKey: attachmentId as NSString) as Data?
    }

    private static func store(_ data: Data, for attachmentId: String) {
        cache.setObject(data as NSData, forKey: attachmentId as NSString, cost: data.count)
    }

    #if DEBUG
    /// Test hook — clear the shared cache so cases don't leak into each other.
    static func clearCacheForTesting() {
        cache.removeAllObjects()
    }
    #endif
}
