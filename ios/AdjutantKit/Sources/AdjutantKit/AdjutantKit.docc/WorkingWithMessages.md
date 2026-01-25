# Working with Messages

Learn how to send, receive, and manage messages in the Gas Town system.

## Overview

Messages are the primary communication mechanism in Gas Town. Agents use messages to coordinate work, report status, and escalate issues. AdjutantKit provides a complete API for message operations.

## Fetching Messages

### Get Inbox

Retrieve all messages for the current identity:

```swift
let messages = try await client.getMail()

// Process unread messages
for message in messages where !message.read {
    print("From: \(message.senderName)")
    print("Subject: \(message.subject)")
    print("---")
}
```

### Get Specific Message

```swift
let message = try await client.getMessage(id: "gb-53tj")
print(message.body)
```

### Filter by Rig

```swift
// Get messages for a specific rig
let rigMail = try await client.getMail(rig: "greenplace")
```

## Sending Messages

### Basic Message

```swift
try await client.sendMail(
    to: "mayor/",
    subject: "Status Report",
    body: "All systems operational. No issues to report."
)
```

### With Priority

Messages support priority levels from urgent (0) to lowest (4):

```swift
try await client.sendMail(
    to: "greenplace/witness",
    subject: "URGENT: System failure detected",
    body: "Main database is unreachable.",
    priority: .urgent  // P0
)
```

### Reply to Message

When replying, include the original message ID:

```swift
try await client.sendMail(
    to: originalMessage.from,
    subject: "Re: \(originalMessage.subject)",
    body: "Thank you for the update.",
    replyTo: originalMessage.id
)
```

## Message Properties

### Priority Levels

| Priority | Value | Use Case |
|----------|-------|----------|
| `.urgent` | 0 | Critical failures requiring immediate attention |
| `.high` | 1 | Important issues that should be addressed soon |
| `.normal` | 2 | Standard communications (default) |
| `.low` | 3 | Non-urgent updates |
| `.lowest` | 4 | Background information |

### Message Types

| Type | Description |
|------|-------------|
| `.task` | Work assignment |
| `.reply` | Response to another message |
| `.report` | Status or progress report |
| `.alert` | System notification |
| `.ack` | Acknowledgment |
| `.handoff` | Work handoff between agents |

## Managing Messages

### Mark as Read

```swift
try await client.markMessageRead(id: message.id)
```

### Delete Message

```swift
try await client.deleteMessage(id: message.id)
```

## Threading

Messages can be grouped into threads using `threadId`:

```swift
let threadMessages = messages.filter {
    $0.threadId == originalMessage.threadId
}

// Sort by timestamp for conversation view
let conversation = threadMessages.sorted {
    ($0.date ?? .distantPast) < ($1.date ?? .distantPast)
}
```

## Best Practices

1. **Use appropriate priorities** - Reserve urgent/high for actual emergencies
2. **Thread conversations** - Use `replyTo` to maintain context
3. **Keep subjects descriptive** - Help recipients quickly understand the topic
4. **Include context in body** - Don't assume recipients know the full situation
