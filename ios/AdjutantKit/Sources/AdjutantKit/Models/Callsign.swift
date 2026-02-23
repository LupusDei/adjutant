import Foundation

/// A StarCraft hero callsign with race and availability status.
/// Used for assigning memorable names to agents on spawn.
public struct Callsign: Codable, Identifiable, Equatable, Hashable {
    public var id: String { name }
    public let name: String
    public let race: CallsignRace
    public let available: Bool

    public init(name: String, race: CallsignRace, available: Bool) {
        self.name = name
        self.race = race
        self.available = available
    }
}

/// StarCraft race for callsign grouping.
public enum CallsignRace: String, Codable, CaseIterable {
    case terran
    case zerg
    case protoss
}
