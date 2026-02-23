# 014: Immediate Message Delivery

## Problem

Messages are inserted into SQLite with `deliveryStatus = 'pending'` and **never transition** to `delivered`. Since messages are broadcast immediately via WebSocket on insert, the `pending` status is a lie — there is no queue, no retry, no background job. The status field misleads both the UI and agents reading messages.

## Solution

Insert messages with `deliveryStatus = 'delivered'` since broadcast happens synchronously on insert. The `pending` state is only meaningful if there's an actual queue — which there isn't.

## Changes

### Task 1: Update message-store INSERT default
- Change hardcoded `'pending'` to `'delivered'` in the INSERT statement
- Update `getUnreadCounts()` to only count `delivery_status = 'delivered'` (more precise than `!= 'read'`)

### Task 2: Update tests
- Fix any tests that assert `deliveryStatus: 'pending'` on newly inserted messages
- Verify unread counts still work correctly

## Out of Scope
- Adding a real queue/retry mechanism (not needed — broadcast is synchronous)
- Changing the `read` status flow (already works via markRead)
