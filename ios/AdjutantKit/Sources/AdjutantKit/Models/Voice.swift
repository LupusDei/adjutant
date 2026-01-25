import Foundation

/// Voice configuration for an agent or default
public struct VoiceConfig: Codable, Equatable, Hashable {
    public let voiceId: String
    public let name: String
    public let speed: Double
    public let stability: Double?
    public let similarityBoost: Double?

    public init(
        voiceId: String,
        name: String,
        speed: Double,
        stability: Double? = nil,
        similarityBoost: Double? = nil
    ) {
        self.voiceId = voiceId
        self.name = name
        self.speed = speed
        self.stability = stability
        self.similarityBoost = similarityBoost
    }
}

/// Full voice configuration including default and per-agent settings
public struct VoiceConfiguration: Codable, Equatable {
    public let defaultVoice: VoiceConfig
    public let agents: [String: VoiceConfig]
    public let enabled: Bool

    public init(defaultVoice: VoiceConfig, agents: [String: VoiceConfig], enabled: Bool) {
        self.defaultVoice = defaultVoice
        self.agents = agents
        self.enabled = enabled
    }
}

/// Voice status response
public struct VoiceStatus: Codable, Equatable {
    public let available: Bool

    public init(available: Bool) {
        self.available = available
    }
}

/// Voice config response wrapper
public struct VoiceConfigResponse: Codable, Equatable {
    public let enabled: Bool
    public let config: VoiceConfiguration

    public init(enabled: Bool, config: VoiceConfiguration) {
        self.enabled = enabled
        self.config = config
    }
}

/// Request body for text-to-speech synthesis
public struct SynthesizeRequest: Encodable {
    /// Text content to synthesize (required, max 5000 chars)
    public let text: String
    /// Optional specific voice ID (overrides agent lookup)
    public var voiceId: String?
    /// Optional agent ID for voice lookup
    public var agentId: String?
    /// Optional message ID for caching
    public var messageId: String?

    public init(text: String, voiceId: String? = nil, agentId: String? = nil, messageId: String? = nil) {
        self.text = text
        self.voiceId = voiceId
        self.agentId = agentId
        self.messageId = messageId
    }
}

/// Response from voice synthesis
public struct SynthesizeResponse: Codable, Equatable {
    /// URL path to access the audio file
    public let audioUrl: String
    /// Duration of audio in seconds
    public let duration: Double
    /// Whether audio was served from cache
    public let cached: Bool
    /// Voice ID used for synthesis
    public let voiceId: String

    public init(audioUrl: String, duration: Double, cached: Bool, voiceId: String) {
        self.audioUrl = audioUrl
        self.duration = duration
        self.cached = cached
        self.voiceId = voiceId
    }
}

/// Transcription response
public struct TranscriptionResponse: Codable, Equatable {
    /// Transcribed text
    public let text: String
    /// Confidence score (0-1)
    public let confidence: Double

    public init(text: String, confidence: Double) {
        self.text = text
        self.confidence = confidence
    }
}

/// Notification settings
public struct NotificationSettings: Codable, Equatable {
    public var enabled: Bool
    public var volume: Double
    public var priorities: PriorityFilters
    public var sources: SourceFilters

    public init(enabled: Bool, volume: Double, priorities: PriorityFilters, sources: SourceFilters) {
        self.enabled = enabled
        self.volume = volume
        self.priorities = priorities
        self.sources = sources
    }
}

/// Priority filter toggles for notifications
public struct PriorityFilters: Codable, Equatable {
    public var urgent: Bool
    public var high: Bool
    public var normal: Bool
    public var low: Bool

    public init(urgent: Bool = true, high: Bool = true, normal: Bool = true, low: Bool = true) {
        self.urgent = urgent
        self.high = high
        self.normal = normal
        self.low = low
    }
}

/// Source filter toggles for notifications
public struct SourceFilters: Codable, Equatable {
    public var mail: Bool
    public var system: Bool
    public var agent: Bool

    public init(mail: Bool = true, system: Bool = true, agent: Bool = true) {
        self.mail = mail
        self.system = system
        self.agent = agent
    }
}

/// Request body for notification audio
public struct NotificationRequest: Encodable {
    public let text: String
    public var priority: String?
    public var source: String?

    public init(text: String, priority: String? = nil, source: String? = nil) {
        self.text = text
        self.priority = priority
        self.source = source
    }
}

/// Response for notification (either synthesized or skipped)
public enum NotificationResponse: Decodable {
    case synthesized(SynthesizeResponse)
    case skipped(reason: String)

    private enum CodingKeys: String, CodingKey {
        case skipped
        case reason
        case audioUrl
        case duration
        case cached
        case voiceId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let skipped = try? container.decode(Bool.self, forKey: .skipped), skipped {
            let reason = try container.decode(String.self, forKey: .reason)
            self = .skipped(reason: reason)
        } else {
            let response = SynthesizeResponse(
                audioUrl: try container.decode(String.self, forKey: .audioUrl),
                duration: try container.decode(Double.self, forKey: .duration),
                cached: try container.decode(Bool.self, forKey: .cached),
                voiceId: try container.decode(String.self, forKey: .voiceId)
            )
            self = .synthesized(response)
        }
    }
}

/// Agent voice configuration response
public struct AgentVoiceConfig: Codable, Equatable, Hashable {
    public let agentId: String
    public let voiceId: String
    public var voiceName: String?
    public var speed: Double?
    public var stability: Double?
    public var similarityBoost: Double?

    public init(
        agentId: String,
        voiceId: String,
        voiceName: String? = nil,
        speed: Double? = nil,
        stability: Double? = nil,
        similarityBoost: Double? = nil
    ) {
        self.agentId = agentId
        self.voiceId = voiceId
        self.voiceName = voiceName
        self.speed = speed
        self.stability = stability
        self.similarityBoost = similarityBoost
    }
}

/// Request body for updating agent voice config
public struct AgentVoiceConfigUpdate: Encodable {
    public let voiceId: String
    public var voiceName: String?
    public var speed: Double?
    public var stability: Double?
    public var similarityBoost: Double?

    public init(
        voiceId: String,
        voiceName: String? = nil,
        speed: Double? = nil,
        stability: Double? = nil,
        similarityBoost: Double? = nil
    ) {
        self.voiceId = voiceId
        self.voiceName = voiceName
        self.speed = speed
        self.stability = stability
        self.similarityBoost = similarityBoost
    }
}

/// Default voice configuration
public struct DefaultVoiceConfig: Codable, Equatable, Hashable {
    public let voiceId: String
    public var voiceName: String?
    public var speed: Double?
    public var stability: Double?
    public var similarityBoost: Double?

    public init(
        voiceId: String,
        voiceName: String? = nil,
        speed: Double? = nil,
        stability: Double? = nil,
        similarityBoost: Double? = nil
    ) {
        self.voiceId = voiceId
        self.voiceName = voiceName
        self.speed = speed
        self.stability = stability
        self.similarityBoost = similarityBoost
    }
}
