import Foundation
@testable import AdjutantKit

/// Mock URL protocol for testing API requests without network
final class MockURLProtocol: URLProtocol {
    /// Handler type for mock responses
    typealias MockHandler = (URLRequest) throws -> (HTTPURLResponse, Data)

    /// The current mock handler
    static var mockHandler: MockHandler?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = MockURLProtocol.mockHandler else {
            fatalError("MockURLProtocol.mockHandler not set")
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

// MARK: - Test Helpers

extension MockURLProtocol {
    /// Create a mock response with JSON data
    static func mockResponse(
        statusCode: Int = 200,
        json: Any
    ) -> MockHandler {
        { request in
            let data = try JSONSerialization.data(withJSONObject: json)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
    }

    /// Create a mock success response with data
    static func mockSuccess<T: Encodable>(data: T) -> MockHandler {
        { request in
            let envelope: [String: Any] = [
                "success": true,
                "data": try JSONSerialization.jsonObject(with: JSONEncoder().encode(data)),
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            let responseData = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, responseData)
        }
    }

    /// Create a mock error response
    static func mockError(
        statusCode: Int,
        code: String,
        message: String
    ) -> MockHandler {
        { request in
            let envelope: [String: Any] = [
                "success": false,
                "error": [
                    "code": code,
                    "message": message
                ],
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ]
            let data = try JSONSerialization.data(withJSONObject: envelope)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            return (response, data)
        }
    }

    /// Create a mock network error
    static func mockNetworkError(_ error: URLError.Code) -> MockHandler {
        { _ in
            throw URLError(error)
        }
    }

    /// Helper to get request body data from either httpBody or httpBodyStream
    static func getBodyData(from request: URLRequest) -> Data? {
        if let body = request.httpBody {
            return body
        }
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            let bufferSize = 1024
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let bytesRead = stream.read(buffer, maxLength: bufferSize)
                if bytesRead > 0 {
                    data.append(buffer, count: bytesRead)
                } else {
                    break
                }
            }
            return data.isEmpty ? nil : data
        }
        return nil
    }
}
