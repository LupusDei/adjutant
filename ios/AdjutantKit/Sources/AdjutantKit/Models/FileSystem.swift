import Foundation

/// A single entry in a directory listing.
public struct DirectoryEntry: Codable, Identifiable, Equatable, Hashable {
    public let name: String
    public let path: String
    public let type: EntryType
    public let size: Int
    public let lastModified: String

    public var id: String { path }

    public var isDirectory: Bool { type == .directory }
    public var isMarkdown: Bool { name.hasSuffix(".md") }

    public enum EntryType: String, Codable {
        case file
        case directory
    }

    public init(name: String, path: String, type: EntryType, size: Int, lastModified: String) {
        self.name = name
        self.path = path
        self.type = type
        self.size = size
        self.lastModified = lastModified
    }
}

/// Response from file read endpoint.
public struct FileContent: Codable, Equatable {
    public let path: String
    public let content: String
    public let size: Int
    public let mimeType: String

    public var isMarkdown: Bool { mimeType == "text/markdown" || path.hasSuffix(".md") }

    public init(path: String, content: String, size: Int, mimeType: String) {
        self.path = path
        self.content = content
        self.size = size
        self.mimeType = mimeType
    }
}
