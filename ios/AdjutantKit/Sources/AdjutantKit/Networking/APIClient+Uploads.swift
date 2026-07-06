import Foundation

// MARK: - Uploads Endpoints (adj-203)

extension APIClient {
    /// Upload a single image as a first-class message attachment.
    ///
    /// Maps to `POST /api/uploads` (multipart/form-data, field name `file`).
    ///
    /// - Parameters:
    ///   - data: Raw image bytes.
    ///   - filename: Original filename (used server-side for the `filename` field).
    ///   - mimeType: Image MIME type (png/jpeg/gif/webp).
    /// - Returns: An ``UploadResult`` whose `id` is passed as an `attachmentId` on send.
    /// - Throws: ``APIClientError`` on validation (4xx), decoding, or network failure.
    public func uploadImage(
        data: Data,
        filename: String,
        mimeType: String
    ) async throws -> UploadResult {
        let boundary = "Boundary-\(UUID().uuidString)"
        let body = Self.multipartBody(
            fieldName: "file",
            filename: filename,
            mimeType: mimeType,
            fileData: data,
            boundary: boundary
        )

        let (responseData, _) = try await requestData(
            .post,
            path: "/uploads",
            body: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        )

        // The route returns a `{ success, data }` envelope.
        let decoder = JSONDecoder()
        let envelope = try decoder.decode(ApiResponse<UploadResult>.self, from: responseData)
        if envelope.success, let result = envelope.data {
            return result
        } else if let error = envelope.error {
            throw APIClientError.serverError(error)
        } else {
            throw APIClientError.decodingError("Upload response success=true but no data")
        }
    }

    /// The authenticated stream URL for a stored upload.
    ///
    /// Maps to `GET /api/uploads/:id`. NOTE: this endpoint is behind `apiKeyAuth`,
    /// so a bare `AsyncImage(url:)` will 401. Use ``fetchUploadData(id:)`` to load
    /// the bytes through the authenticated client, or attach the API key header
    /// yourself when requesting this URL.
    public func uploadURL(id: String) -> URL {
        configuration.baseURL
            .appendingPathComponent("uploads")
            .appendingPathComponent(id)
    }

    /// Fetch the raw bytes for a stored upload through the authenticated client.
    ///
    /// Maps to `GET /api/uploads/:id`. Sends the same `Authorization: Bearer`
    /// header as every other API call, so it works against the authenticated
    /// `/uploads/:id` route (the render path — adj-203.5.3).
    ///
    /// - Parameter id: The upload/attachment id.
    /// - Returns: The raw image bytes.
    public func fetchUploadData(id: String) async throws -> Data {
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let (data, _) = try await requestData(.get, path: "/uploads/\(encodedId)")
        return data
    }

    // MARK: - Multipart helper

    /// Build a minimal `multipart/form-data` body with a single file part.
    static func multipartBody(
        fieldName: String,
        filename: String,
        mimeType: String,
        fileData: Data,
        boundary: String
    ) -> Data {
        var body = Data()
        func appendString(_ string: String) {
            if let d = string.data(using: .utf8) { body.append(d) }
        }
        appendString("--\(boundary)\r\n")
        appendString("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(filename)\"\r\n")
        appendString("Content-Type: \(mimeType)\r\n\r\n")
        body.append(fileData)
        appendString("\r\n--\(boundary)--\r\n")
        return body
    }
}
