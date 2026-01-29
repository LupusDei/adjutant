# Getting Started with AdjutantKit

Learn how to configure and use the AdjutantKit API client.

## Overview

AdjutantKit provides a Swift-native interface for communicating with the Adjutant backend server. This guide covers initial setup, configuration options, and common usage patterns.

## Installation

Add AdjutantKit to your Xcode project using Swift Package Manager:

```swift
dependencies: [
    .package(path: "../AdjutantKit")
]
```

Or add it to your `Package.swift`:

```swift
.package(name: "AdjutantKit", path: "AdjutantKit")
```

## Configuration

### Development Configuration

For local development, use the default configuration which connects to `localhost:4201`:

```swift
import AdjutantKit

let client = APIClient()
```

### Custom Configuration

For production or custom environments, create a configuration:

```swift
let config = APIClientConfiguration(
    baseURL: URL(string: "https://api.example.com/api")!,
    defaultTimeout: 30.0,
    retryPolicy: .aggressive
)
let client = APIClient(configuration: config)
```

### Configuration Options

| Parameter | Default | Description |
|-----------|---------|-------------|
| `baseURL` | `http://localhost:4201/api` | Backend API base URL |
| `defaultTimeout` | 30s | Default request timeout |
| `terminalTimeout` | 10s | Timeout for terminal polling |
| `voiceTimeout` | 60s | Timeout for voice synthesis |
| `retryPolicy` | `.default` | Retry behavior on failures |

## Making API Calls

### Fetching Data

All API methods are async and can throw errors:

```swift
do {
    // Get system status
    let status = try await client.getStatus()
    print("Uptime: \(status.uptime ?? "unknown")")

    // Get all agents
    let agents = try await client.getAgents()
    for agent in agents {
        print("\(agent.name): \(agent.status)")
    }

    // Get mail inbox
    let messages = try await client.getMail()
    let unread = messages.filter { !$0.read }
    print("Unread messages: \(unread.count)")

} catch let error as APIClientError {
    print("API Error: \(error.localizedDescription)")
}
```

### Sending Messages

```swift
try await client.sendMail(
    to: "greenplace/witness",
    subject: "Alert",
    body: "Detected unusual activity.",
    priority: .high
)
```

### Working with Beads

```swift
// Get all beads for a rig
let beads = try await client.getBeads(rig: "greenplace")

// Filter by status
let openBeads = beads.filter { $0.status == "open" }
```

## Error Handling

AdjutantKit provides typed errors through ``APIClientError``:

```swift
do {
    let status = try await client.getStatus()
} catch APIClientError.networkError(let message) {
    // Handle network connectivity issues
    showOfflineMessage()
} catch APIClientError.timeout {
    // Handle timeout
    retryWithBackoff()
} catch APIClientError.rateLimited(let retryAfter) {
    // Handle rate limiting
    if let delay = retryAfter {
        scheduleRetry(after: delay)
    }
} catch {
    // Handle other errors
    print("Unexpected error: \(error)")
}
```

### Retryable Errors

Check if an error is safe to retry:

```swift
catch let error as APIClientError {
    if error.isRetryable {
        // Safe to retry this request
        try await retryRequest()
    }
}
```

## Best Practices

1. **Reuse the client** - Create one ``APIClient`` instance and share it
2. **Handle errors gracefully** - Always catch and handle potential errors
3. **Respect rate limits** - Honor `retryAfter` values from rate limiting
4. **Use appropriate timeouts** - Configure timeouts based on operation type
