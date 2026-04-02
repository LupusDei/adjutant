import Foundation

// MARK: - Persona Endpoints

extension APIClient {
    /// Fetches all personas.
    ///
    /// Maps to `GET /api/personas`
    ///
    /// - Returns: An array of ``Persona`` items sorted by name.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getPersonas(includeCallsign: Bool = false) async throws -> [Persona] {
        if includeCallsign {
            return try await requestWithEnvelope(.get, path: "/personas", queryItems: [
                URLQueryItem(name: "includeCallsign", value: "true")
            ])
        }
        return try await requestWithEnvelope(.get, path: "/personas")
    }

    /// Fetches a single persona by ID.
    ///
    /// Maps to `GET /api/personas/:id`
    ///
    /// - Parameter id: The persona UUID.
    /// - Returns: A ``Persona``.
    /// - Throws: ``APIClientError`` if the request fails or persona is not found.
    public func getPersona(id: String) async throws -> Persona {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/personas/\(encodedId)")
    }

    /// Creates a new persona.
    ///
    /// Maps to `POST /api/personas`
    ///
    /// - Parameter request: The creation request containing name, description, and traits.
    /// - Returns: The newly created ``Persona``.
    /// - Throws: ``APIClientError`` if the request fails.
    public func createPersona(_ request: CreatePersonaRequest) async throws -> Persona {
        try await requestWithEnvelope(.post, path: "/personas", body: request)
    }

    /// Updates an existing persona.
    ///
    /// Maps to `PUT /api/personas/:id`
    ///
    /// - Parameters:
    ///   - id: The persona UUID.
    ///   - request: The update request with optional name, description, and traits.
    /// - Returns: The updated ``Persona``.
    /// - Throws: ``APIClientError`` if the request fails or persona is not found.
    public func updatePersona(id: String, _ request: UpdatePersonaRequest) async throws -> Persona {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.put, path: "/personas/\(encodedId)", body: request)
    }

    /// Deletes a persona by ID.
    ///
    /// Maps to `DELETE /api/personas/:id`
    ///
    /// - Parameter id: The persona UUID.
    /// - Throws: ``APIClientError`` if the request fails or persona is not found.
    public func deletePersona(id: String) async throws {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let _: SuccessResponse = try await requestWithEnvelope(.delete, path: "/personas/\(encodedId)")
    }

    /// Fetches the generated system prompt for a persona.
    ///
    /// Maps to `GET /api/personas/:id/prompt`
    ///
    /// - Parameter id: The persona UUID.
    /// - Returns: A ``PersonaPromptResponse`` with the prompt text and persona.
    /// - Throws: ``APIClientError`` if the request fails or persona is not found.
    public func getPersonaPrompt(id: String) async throws -> PersonaPromptResponse {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await requestWithEnvelope(.get, path: "/personas/\(encodedId)/prompt")
    }
}

// MARK: - Callsign Toggle Endpoints

extension APIClient {
    /// Fetches all callsign toggle settings.
    ///
    /// Maps to `GET /api/callsigns`
    ///
    /// - Returns: A ``CallsignTogglesResponse`` with all callsigns and master toggle state.
    /// - Throws: ``APIClientError`` if the request fails.
    public func getCallsignToggles() async throws -> CallsignTogglesResponse {
        try await requestWithEnvelope(.get, path: "/callsigns")
    }

    /// Toggles an individual callsign enabled/disabled.
    ///
    /// Maps to `PUT /api/callsigns/:name/toggle`
    ///
    /// - Parameters:
    ///   - name: The callsign name to toggle.
    ///   - enabled: Whether to enable or disable the callsign.
    /// - Returns: A ``CallsignToggleResponse``.
    /// - Throws: ``APIClientError`` if the request fails.
    public func toggleCallsign(name: String, enabled: Bool) async throws -> CallsignToggleResponse {
        let encodedName = name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name
        let request = CallsignToggleRequest(enabled: enabled)
        return try await requestWithEnvelope(.put, path: "/callsigns/\(encodedName)/toggle", body: request)
    }

    /// Toggles all callsigns enabled/disabled at once (master toggle).
    ///
    /// Maps to `PUT /api/callsigns/toggle-all`
    ///
    /// - Parameter enabled: Whether to enable or disable all callsigns.
    /// - Returns: A ``CallsignToggleResponse``.
    /// - Throws: ``APIClientError`` if the request fails.
    public func toggleAllCallsigns(enabled: Bool) async throws -> CallsignToggleResponse {
        let request = CallsignToggleRequest(enabled: enabled)
        return try await requestWithEnvelope(.put, path: "/callsigns/toggle-all", body: request)
    }
}
