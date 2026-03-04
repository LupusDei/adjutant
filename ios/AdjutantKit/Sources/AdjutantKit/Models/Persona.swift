import Foundation

// MARK: - PersonaTrait

/// The 12 personality trait dimensions for a persona.
/// Each maps to a behavioral axis that influences prompt generation.
public enum PersonaTrait: String, Codable, CaseIterable, Hashable {
    case architectureFocus
    case productDesign
    case uiuxFocus
    case qaScalability
    case qaCorrectness
    case testingUnit
    case testingAcceptance
    case modularArchitecture
    case businessObjectives
    case technicalDepth
    case codeReview
    case documentation

    /// CodingKeys mapping to backend snake_case trait names.
    private enum CodingKeys: String, CodingKey {
        case architectureFocus = "architecture_focus"
        case productDesign = "product_design"
        case uiuxFocus = "uiux_focus"
        case qaScalability = "qa_scalability"
        case qaCorrectness = "qa_correctness"
        case testingUnit = "testing_unit"
        case testingAcceptance = "testing_acceptance"
        case modularArchitecture = "modular_architecture"
        case businessObjectives = "business_objectives"
        case technicalDepth = "technical_depth"
        case codeReview = "code_review"
        case documentation
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        // Support both camelCase and snake_case decoding
        switch rawValue {
        case "architecture_focus", "architectureFocus": self = .architectureFocus
        case "product_design", "productDesign": self = .productDesign
        case "uiux_focus", "uiuxFocus": self = .uiuxFocus
        case "qa_scalability", "qaScalability": self = .qaScalability
        case "qa_correctness", "qaCorrectness": self = .qaCorrectness
        case "testing_unit", "testingUnit": self = .testingUnit
        case "testing_acceptance", "testingAcceptance": self = .testingAcceptance
        case "modular_architecture", "modularArchitecture": self = .modularArchitecture
        case "business_objectives", "businessObjectives": self = .businessObjectives
        case "technical_depth", "technicalDepth": self = .technicalDepth
        case "code_review", "codeReview": self = .codeReview
        case "documentation": self = .documentation
        default:
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unknown PersonaTrait value: \(rawValue)"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(snakeCaseValue)
    }

    /// Snake-case representation matching the backend API.
    public var snakeCaseValue: String {
        switch self {
        case .architectureFocus: return "architecture_focus"
        case .productDesign: return "product_design"
        case .uiuxFocus: return "uiux_focus"
        case .qaScalability: return "qa_scalability"
        case .qaCorrectness: return "qa_correctness"
        case .testingUnit: return "testing_unit"
        case .testingAcceptance: return "testing_acceptance"
        case .modularArchitecture: return "modular_architecture"
        case .businessObjectives: return "business_objectives"
        case .technicalDepth: return "technical_depth"
        case .codeReview: return "code_review"
        case .documentation: return "documentation"
        }
    }
}

// MARK: - TraitCategory

/// Groupings of traits into cognitive categories.
public enum TraitCategory: String, CaseIterable, Identifiable {
    case engineering = "ENGINEERING"
    case quality = "QUALITY"
    case product = "PRODUCT"
    case craft = "CRAFT"

    public var id: String { rawValue }

    /// Short label for radar chart axes.
    public var shortLabel: String {
        switch self {
        case .engineering: return "ENG"
        case .quality: return "QUA"
        case .product: return "PRD"
        case .craft: return "CRF"
        }
    }

    /// Traits belonging to this category.
    public var traits: [PersonaTrait] {
        switch self {
        case .engineering:
            return [.architectureFocus, .modularArchitecture, .technicalDepth]
        case .quality:
            return [.qaScalability, .qaCorrectness, .testingUnit, .testingAcceptance]
        case .product:
            return [.productDesign, .businessObjectives, .documentation]
        case .craft:
            return [.uiuxFocus, .codeReview]
        }
    }
}

// MARK: - TraitDisplayInfo

/// Display metadata for a single trait.
public struct TraitDisplayInfo {
    /// Human-readable label
    public let label: String
    /// Description of what this trait controls
    public let description: String

    public init(label: String, description: String) {
        self.label = label
        self.description = description
    }
}

/// Canonical display info for all traits, used by editor and detail views.
public let traitDisplayInfo: [PersonaTrait: TraitDisplayInfo] = [
    .architectureFocus: TraitDisplayInfo(
        label: "ARCHITECTURE",
        description: "System design, dependency management, clean abstractions"
    ),
    .productDesign: TraitDisplayInfo(
        label: "PRODUCT DESIGN",
        description: "Product thinking, user needs, feature completeness"
    ),
    .uiuxFocus: TraitDisplayInfo(
        label: "UI/UX FOCUS",
        description: "Visual design, interaction patterns, accessibility"
    ),
    .qaScalability: TraitDisplayInfo(
        label: "QA: SCALABILITY",
        description: "Performance testing, load handling, scaling concerns"
    ),
    .qaCorrectness: TraitDisplayInfo(
        label: "QA: CORRECTNESS",
        description: "Functional correctness, edge cases, does everything work"
    ),
    .testingUnit: TraitDisplayInfo(
        label: "TESTING: UNIT",
        description: "Unit test rigor, TDD discipline, mock strategies"
    ),
    .testingAcceptance: TraitDisplayInfo(
        label: "TESTING: E2E",
        description: "Integration/E2E test coverage, acceptance criteria"
    ),
    .modularArchitecture: TraitDisplayInfo(
        label: "MODULARITY",
        description: "Separation of concerns, clean interfaces, composability"
    ),
    .businessObjectives: TraitDisplayInfo(
        label: "BUSINESS OBJ",
        description: "Business value alignment, ROI thinking, prioritization"
    ),
    .technicalDepth: TraitDisplayInfo(
        label: "TECH DEPTH",
        description: "Low-level knowledge, performance optimization, algorithms"
    ),
    .codeReview: TraitDisplayInfo(
        label: "CODE REVIEW",
        description: "Review thoroughness, attention to detail, mentoring"
    ),
    .documentation: TraitDisplayInfo(
        label: "DOCUMENTATION",
        description: "Code comments, README, API docs, inline documentation"
    ),
]

// MARK: - TraitValues

/// Stores point allocations for all 12 persona traits.
/// Each trait ranges from 0 to `traitMax` (20), with a total budget of `pointBudget` (100).
public struct TraitValues: Codable, Equatable, Hashable {
    /// Maximum points for any single trait
    public static let traitMax: Int = 20

    /// Total point budget across all traits
    public static let pointBudget: Int = 100

    /// An empty trait allocation (all zeros)
    public static let empty = TraitValues()

    // MARK: - Storage

    public var architectureFocus: Int
    public var productDesign: Int
    public var uiuxFocus: Int
    public var qaScalability: Int
    public var qaCorrectness: Int
    public var testingUnit: Int
    public var testingAcceptance: Int
    public var modularArchitecture: Int
    public var businessObjectives: Int
    public var technicalDepth: Int
    public var codeReview: Int
    public var documentation: Int

    // MARK: - Initialization

    public init(
        architectureFocus: Int = 0,
        productDesign: Int = 0,
        uiuxFocus: Int = 0,
        qaScalability: Int = 0,
        qaCorrectness: Int = 0,
        testingUnit: Int = 0,
        testingAcceptance: Int = 0,
        modularArchitecture: Int = 0,
        businessObjectives: Int = 0,
        technicalDepth: Int = 0,
        codeReview: Int = 0,
        documentation: Int = 0
    ) {
        self.architectureFocus = architectureFocus
        self.productDesign = productDesign
        self.uiuxFocus = uiuxFocus
        self.qaScalability = qaScalability
        self.qaCorrectness = qaCorrectness
        self.testingUnit = testingUnit
        self.testingAcceptance = testingAcceptance
        self.modularArchitecture = modularArchitecture
        self.businessObjectives = businessObjectives
        self.technicalDepth = technicalDepth
        self.codeReview = codeReview
        self.documentation = documentation
    }

    // MARK: - Codable (snake_case keys)

    private enum CodingKeys: String, CodingKey {
        case architectureFocus = "architecture_focus"
        case productDesign = "product_design"
        case uiuxFocus = "uiux_focus"
        case qaScalability = "qa_scalability"
        case qaCorrectness = "qa_correctness"
        case testingUnit = "testing_unit"
        case testingAcceptance = "testing_acceptance"
        case modularArchitecture = "modular_architecture"
        case businessObjectives = "business_objectives"
        case technicalDepth = "technical_depth"
        case codeReview = "code_review"
        case documentation
    }

    // MARK: - Computed Properties

    /// Sum of all trait point allocations.
    public var totalPoints: Int {
        architectureFocus + productDesign + uiuxFocus +
        qaScalability + qaCorrectness + testingUnit +
        testingAcceptance + modularArchitecture + businessObjectives +
        technicalDepth + codeReview + documentation
    }

    /// Alias for totalPoints (used by some views).
    public var total: Int { totalPoints }

    /// Whether the total is within the allowed budget.
    public var isWithinBudget: Bool {
        totalPoints <= Self.pointBudget
    }

    /// Number of points over budget (0 if within budget).
    public var overBudgetBy: Int {
        max(0, totalPoints - Self.pointBudget)
    }

    // MARK: - Per-Trait Access

    /// Get the value for a specific trait.
    public func value(for trait: PersonaTrait) -> Int {
        switch trait {
        case .architectureFocus: return architectureFocus
        case .productDesign: return productDesign
        case .uiuxFocus: return uiuxFocus
        case .qaScalability: return qaScalability
        case .qaCorrectness: return qaCorrectness
        case .testingUnit: return testingUnit
        case .testingAcceptance: return testingAcceptance
        case .modularArchitecture: return modularArchitecture
        case .businessObjectives: return businessObjectives
        case .technicalDepth: return technicalDepth
        case .codeReview: return codeReview
        case .documentation: return documentation
        }
    }

    /// Set the value for a specific trait.
    public mutating func setValue(_ value: Int, for trait: PersonaTrait) {
        let clamped = max(0, min(Self.traitMax, value))
        switch trait {
        case .architectureFocus: architectureFocus = clamped
        case .productDesign: productDesign = clamped
        case .uiuxFocus: uiuxFocus = clamped
        case .qaScalability: qaScalability = clamped
        case .qaCorrectness: qaCorrectness = clamped
        case .testingUnit: testingUnit = clamped
        case .testingAcceptance: testingAcceptance = clamped
        case .modularArchitecture: modularArchitecture = clamped
        case .businessObjectives: businessObjectives = clamped
        case .technicalDepth: technicalDepth = clamped
        case .codeReview: codeReview = clamped
        case .documentation: documentation = clamped
        }
    }

    // MARK: - Category Aggregations

    /// Total points allocated to traits in a category.
    public func categoryTotal(for category: TraitCategory) -> Int {
        category.traits.reduce(0) { $0 + value(for: $1) }
    }

    /// Normalized strength for a category (0.0-1.0).
    /// Computed as the max trait value in the category divided by traitMax.
    public func categoryStrength(for category: TraitCategory) -> Double {
        let maxVal = category.traits.map { value(for: $0) }.max() ?? 0
        return Double(maxVal) / Double(Self.traitMax)
    }
}

// MARK: - Persona

/// A persona defining an agent's personality through trait allocations.
public struct Persona: Codable, Identifiable, Equatable, Hashable {
    /// Unique identifier (UUID)
    public let id: String
    /// Display name
    public let name: String
    /// Description of this persona's role/purpose
    public let description: String
    /// Point allocation across all 12 trait dimensions
    public let traits: TraitValues
    /// ISO 8601 creation timestamp
    public let createdAt: String
    /// ISO 8601 last-update timestamp
    public let updatedAt: String

    public init(
        id: String,
        name: String,
        description: String = "",
        traits: TraitValues = .empty,
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.traits = traits
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, description, traits, createdAt, updatedAt
    }
}

// MARK: - API Request/Response Types

/// Request body for creating a new persona.
public struct CreatePersonaRequest: Codable {
    public let name: String
    public let description: String
    public let traits: TraitValues

    public init(name: String, description: String = "", traits: TraitValues) {
        self.name = name
        self.description = description
        self.traits = traits
    }
}

/// Request body for updating an existing persona.
public struct UpdatePersonaRequest: Codable {
    public let name: String?
    public let description: String?
    public let traits: TraitValues?

    public init(name: String? = nil, description: String? = nil, traits: TraitValues? = nil) {
        self.name = name
        self.description = description
        self.traits = traits
    }
}

/// Response from the persona prompt endpoint.
public struct PersonaPromptResponse: Codable {
    /// The generated system prompt text
    public let prompt: String
    /// The persona used to generate the prompt
    public let persona: Persona

    public init(prompt: String, persona: Persona) {
        self.prompt = prompt
        self.persona = persona
    }
}

// MARK: - Callsign Settings Types

/// A callsign with its enabled/disabled toggle state.
public struct CallsignSetting: Codable, Identifiable, Equatable, Hashable {
    public var id: String { name }
    /// Callsign name
    public let name: String
    /// Whether this callsign is enabled for assignment
    public let enabled: Bool

    public init(name: String, enabled: Bool) {
        self.name = name
        self.enabled = enabled
    }
}

/// Response from the callsign toggles endpoint.
public struct CallsignTogglesResponse: Codable {
    /// All callsigns with their enabled status
    public let callsigns: [CallsignSetting]
    /// Whether the master toggle is enabled
    public let masterEnabled: Bool

    public init(callsigns: [CallsignSetting], masterEnabled: Bool) {
        self.callsigns = callsigns
        self.masterEnabled = masterEnabled
    }
}

/// Response from toggling a callsign.
public struct CallsignToggleResponse: Codable {
    /// Whether the toggle operation succeeded
    public let name: String?
    /// The new enabled state
    public let enabled: Bool?
    /// Whether master toggle is enabled (for toggle-all)
    public let masterEnabled: Bool?

    public init(name: String? = nil, enabled: Bool? = nil, masterEnabled: Bool? = nil) {
        self.name = name
        self.enabled = enabled
        self.masterEnabled = masterEnabled
    }
}

/// Request body for toggling a callsign.
public struct CallsignToggleRequest: Codable {
    public let enabled: Bool

    public init(enabled: Bool) {
        self.enabled = enabled
    }
}
