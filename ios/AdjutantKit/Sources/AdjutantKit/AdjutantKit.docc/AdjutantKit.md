# ``AdjutantKit``

A Swift networking layer for the Adjutant iOS app, providing communication with the Gas Town multi-agent orchestration system.

## Overview

AdjutantKit provides a complete networking layer for the Adjutant iOS companion app, including:

- Type-safe API client with async/await support
- Data models for agents, messages, beads, and system status
- Automatic retry logic with exponential backoff
- Comprehensive error handling

The package is designed to work with the Adjutant backend server, which coordinates the Gas Town multi-agent system.

### Quick Start

```swift
import AdjutantKit

// Create a client with default configuration
let client = APIClient()

// Fetch system status
let status = try await client.getStatus()

// Get inbox messages
let messages = try await client.getMail()

// Send a message
try await client.sendMail(
    to: "mayor/",
    subject: "Status Update",
    body: "All systems operational."
)
```

### Architecture

AdjutantKit follows a layered architecture:

1. **APIClient** - The main entry point for all API operations
2. **Models** - Swift types representing system entities
3. **Networking** - HTTP request handling with retry logic
4. **Error Handling** - Typed errors for all failure modes

## Topics

### Essentials

- ``APIClient``
- ``APIClientConfiguration``

### Data Models

- ``Message``
- ``CrewMember``
- ``BeadInfo``
- ``GastownStatus``
- ``Convoy``

### Networking

- ``HTTPMethod``
- ``RetryPolicy``
- ``RetryExecutor``

### Error Handling

- ``APIClientError``
- ``ApiError``
- ``ApiErrorCode``

### Responses

- ``ApiResponse``
- ``EmptyResponse``
- ``SuccessResponse``
- ``IdentityResponse``
