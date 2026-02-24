# Generate Proposal — Agent Skill Reference

This document defines the protocol for agents generating improvement proposals when idle.

## When to Enter Proposal Mode

An agent enters proposal mode when:
1. All assigned beads are closed (`bd ready` returns no work)
2. No pending messages require a response
3. The agent has capacity for creative thinking

## Proposal Generation Protocol

### Step 1: Spawn Two Specialized Teammates

The idle agent spawns two teammates in parallel:

#### Product/UX Teammate
- **Role**: Think deeply about how the application or project can be improved from a user experience and product perspective
- **Focus areas**: UI/UX improvements, new features, workflow optimizations, accessibility, user pain points, information architecture
- **Output**: A single `product` type proposal via `create_proposal`

#### Staff Engineer Teammate
- **Role**: Think deeply about how the codebase can be improved from an engineering perspective
- **Focus areas**: Refactoring opportunities, architectural improvements, performance optimization, tech debt reduction, test coverage gaps, code quality
- **Output**: A single `engineering` type proposal via `create_proposal`

### Step 2: Uniqueness Check (MANDATORY)

Before creating a proposal, each teammate MUST:

1. Call `list_proposals` to retrieve ALL existing proposals (no status filter — check pending, accepted, and dismissed)
2. Review each existing proposal's title and description
3. Ensure the new proposal is genuinely novel — not a duplicate or minor variation of an existing one
4. If the idea is already proposed, think of a different improvement instead

### Step 3: Create the Proposal

Call `create_proposal` with:
- **title**: Concise, actionable title (e.g., "Add keyboard shortcuts for common actions", "Extract shared validation logic into Zod middleware")
- **description**: Deep, detailed description covering:
  - **What**: The specific improvement being proposed
  - **Why**: The problem it solves or value it adds
  - **How**: High-level approach to implementation
  - **Impact**: Expected benefit (performance, UX, maintainability, etc.)
- **type**: `"product"` or `"engineering"`

### Step 4: Announce

After creating the proposal, announce it:
```
announce({
  type: "completion",
  title: "New proposal: <title>",
  body: "Created a <type> proposal: <brief summary>"
})
```

## Spawn Prompt Template

Use this when spawning the proposal teammates:

### Product/UX Teammate Spawn Prompt
```
You are a Product/UX analyst reviewing the adjutant project for improvement opportunities.

Your task: Generate ONE unique, high-quality product/UX improvement proposal.

## Steps:
1. Call `list_proposals` to review ALL existing proposals
2. Explore the codebase to understand current UX patterns and pain points
3. Think deeply about what would make the biggest impact for users
4. Ensure your idea is NOT a duplicate of any existing proposal
5. Call `create_proposal` with type "product", a concise title, and a detailed description covering what/why/how/impact
6. Call `announce` to notify the dashboard

## Guidelines:
- Think from the user's perspective — what friction exists? What's missing?
- Consider both the web frontend and iOS app
- Proposals should be specific and actionable, not vague
- Include enough detail that an agent could create an epic from it
```

### Staff Engineer Teammate Spawn Prompt
```
You are a Staff Engineer reviewing the adjutant codebase for improvement opportunities.

Your task: Generate ONE unique, high-quality engineering improvement proposal.

## Steps:
1. Call `list_proposals` to review ALL existing proposals
2. Explore the codebase — look at architecture, patterns, test coverage, error handling
3. Think deeply about what refactoring or improvement would have the most impact
4. Ensure your idea is NOT a duplicate of any existing proposal
5. Call `create_proposal` with type "engineering", a concise title, and a detailed description covering what/why/how/impact
6. Call `announce` to notify the dashboard

## Guidelines:
- Focus on meaningful improvements, not cosmetic changes
- Consider: performance, reliability, maintainability, testability, security
- Look for patterns that could be simplified or unified
- Proposals should be specific with concrete file paths and approaches
```

## MCP Tools Reference

### create_proposal
```
create_proposal({
  title: "Add keyboard shortcuts for common actions",
  description: "What: Add keyboard shortcuts for navigating tabs, sending messages...\nWhy: Power users currently must use mouse for everything...\nHow: Add a KeyboardShortcutManager...\nImpact: Significantly faster navigation for power users",
  type: "product"
})
```

### list_proposals
```
list_proposals()                           // All proposals
list_proposals({ type: "engineering" })    // Only engineering proposals
list_proposals({ status: "pending" })      // Only pending proposals
```
