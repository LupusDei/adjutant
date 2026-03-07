# Markdown Rendering Test Document

This file exercises ALL Markdown features for manual testing on the iOS device.
Use it via the file browser to verify MarkdownParser and MarkdownTextView.

---

## Section 1: Basic Inline Formatting

**Bold text** should render in bold weight.
*Italic text* should render in italic style.
***Bold italic text*** should render bold and italic.
`inline code` should render in monospace with highlight background.
~~Strikethrough~~ should render with a line through it.
_Underscore italic_ should also render italic.
__Underscore bold__ should also render bold.
___Underscore bold italic___ should render bold and italic.

Mixed formatting: **bold with `code` inside** and *italic with `code` inside*.

---

## Section 2: Links

### Basic Links
[Adjutant Repo](https://github.com/example/adjutant) should be tappable.
[Link with title](https://example.com "Example Title") with title attribute.

### Bare URLs
https://example.com should auto-link (GFM extension).
http://example.com/path?query=value&other=123 with query params.

### Links in Context
Visit [our docs](https://docs.example.com) for more information.
See the [configuration guide](https://example.com/config) or the [API reference](https://example.com/api).

### Edge Cases
[Empty URL]() should handle gracefully.
[Link with parens](https://example.com/path_(disambiguation)) with parentheses in URL.
[Link with special chars](https://example.com/path?a=1&b=2#fragment) with query and fragment.

---

## Section 3: Headings

# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

### Heading with **bold** and `code` inside

##No space after hash (should NOT be a heading)

---

## Section 4: Code Blocks

### Fenced with Language

```typescript
interface VoiceConfig {
  voiceId: string;
  name: string;
  speed: number;
  stability?: number;
}

const config: VoiceConfig = {
  voiceId: "abc123",
  name: "Default",
  speed: 1.0,
};
```

### Fenced without Language

```
Just plain preformatted text.
No syntax highlighting expected.
  Indentation preserved.
```

### Code Block with Pipes (should NOT be parsed as table)

```
| This | Is | Not | A | Table |
|------|-----|-----|---|-------|
| It   | is  | a   | code | block |
```

### Code Block with Markdown Inside (should NOT be parsed)

```markdown
# Not a heading
**Not bold**
- Not a list
| Not | A | Table |
```

### Nested Backticks

````
```
Inner fenced block (should show triple backticks as text)
```
````

---

## Section 5: Blockquotes

> Simple blockquote on one line.

> Multi-line blockquote.
> This continues on the next line.
> And the next.

> Blockquote with **bold** and *italic* and `code`.

> ### Blockquote with heading
>
> And a paragraph below the heading.

> > Nested blockquote (two levels deep).
> > This should be indented further.

> Blockquote with a list inside:
> - Item one
> - Item two
> - Item three

---

## Section 6: Lists

### Unordered Lists

- Item one
- Item two
- Item three

* Asterisk item one
* Asterisk item two
* Asterisk item three

### Ordered Lists

1. First item
2. Second item
3. Third item

1. All starting with 1
1. Markdown allows this
1. Auto-numbers in rendered output

### Nested Lists

- Parent item
  - Child item 1
  - Child item 2
    - Grandchild item
  - Child item 3
- Another parent

1. Ordered parent
   1. Ordered child
   2. Ordered child 2
2. Second ordered parent

### Lists with Inline Formatting

- **Bold list item** with trailing text
- Item with `inline code` inside
- Item with [a link](https://example.com) inside
- ~~Strikethrough item~~
- Item with *italic* and **bold** mixed

### Multi-line List Items

- This is a list item that is
  continued on the next line with indentation.
- Short item.
- Another item with
  multiple continuation lines
  that should render as one item.

---

## Section 7: Task Lists (GFM)

- [ ] Unchecked task
- [x] Checked task (lowercase x)
- [X] Checked task (uppercase X)
- [ ] Task with **bold** text
- [x] Task with `code` text
- [ ] Task with [link](https://example.com)

### Mixed Task and Regular List

- [ ] First task
- Regular list item (not a task)
- [x] Second task
- Another regular item

---

## Section 8: Tables

### Simple Table

| Name | Type | Priority |
|------|------|----------|
| Bug fix | bug | P1 |
| Feature | task | P2 |
| Research | epic | P3 |

### Table with Alignment

| Left | Center | Right |
|:-----|:------:|------:|
| L1 | C1 | R1 |
| L2 | C2 | R2 |
| L3 | C3 | R3 |

### Table with Inline Formatting

| Feature | Status | Notes |
|---------|--------|-------|
| **Tables** | `done` | Renders with Grid |
| *Links* | ~~pending~~ `done` | Now clickable |
| `Code` items | in_progress | See [docs](https://example.com) |

### Table with Empty Cells

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | |
| name | string | | Display name |
| status | | Yes | Current status |
| | string | No | Unnamed field |

### Table without Leading Pipe

Name | Type | Priority
-----|------|----------
Bug fix | bug | P1
Feature | task | P2

### Single Column Table

| Status |
|--------|
| open |
| closed |
| blocked |

### Table with Only Header (no data rows)

| Column A | Column B | Column C |
|----------|----------|----------|

### Wide Table (tests horizontal scroll)

| Field | Type | Required | Default | Description | Example | Validation | Notes |
|-------|------|----------|---------|-------------|---------|------------|-------|
| id | string | Yes | auto | Unique identifier | "adj-001" | UUID format | Primary key |
| title | string | Yes | none | Bead title | "Fix bug" | 1-200 chars | Indexed |
| status | enum | Yes | open | Current status | "in_progress" | Valid enum | Filterable |
| priority | number | No | 2 | Priority 0-4 | 3 | 0-4 range | Sortable |

### Table from Real Spec (Risks & Mitigations)

| Risk | Impact | Mitigation |
|------|--------|------------|
| ElevenLabs API costs | High volume = high cost | Aggressive caching, rate limiting |
| API rate limits | Service degradation | Queue system, graceful fallback |
| Browser audio restrictions | Playback fails | User interaction to enable audio |
| Voice quality variance | Poor UX | Curated voice selection, testing |

### Table with Pipe in Code (edge case)

| Expression | Result |
|------------|--------|
| `a \| b` | Union type |
| `x \|\| y` | Logical OR |

### Table with Long Cell Content

| Module | Can Import From | Cannot Import From |
|--------|----------------|-------------------|
| index.ts | repository, filter, dependency, sorter, types | bd-client |
| beads-repository.ts | bd-client, types | filter, dependency, sorter |
| beads-filter.ts | types | bd-client, repository, dependency, sorter |

---

## Section 9: Horizontal Rules

Three dashes:

---

Three asterisks:

***

Three underscores:

___

With spaces:

- - -

---

## Section 10: Mixed Complex Content

### Real-World Spec Pattern: Summary Table + Details

| Area | Critical | High | Medium | Low | Total |
|------|----------|------|--------|-----|-------|
| Loading States | 2 | 2 | 2 | 0 | 6 |
| Reconnection | 2 | 3 | 1 | 0 | 6 |
| Agent Switching | 1 | 2 | 2 | 1 | 6 |
| **Total** | **6** | **9** | **6** | **2** | **23** |

### Code Block Followed by Table

```typescript
interface BeadAssignment {
  assignee: string | null;
  status?: string;
}
```

| Field | Type | Required |
|-------|------|----------|
| assignee | `string \| null` | Yes |
| status | `string \| undefined` | No |

### Blockquote with Emphasis

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

> **Warning**: This is a _critical_ path. Do not skip `validation` steps.

### List Immediately After Heading

#### Backend Changes
- New endpoint: `PATCH /api/beads/:id`
- Updated schema for `BeadStatus`
- Service method: `updateBeadStatus()`

#### Frontend Changes
1. New `KanbanCard` component
2. Updated `useKanban` hook
3. Modified `BeadsView` layout

### ASCII Art / Diagrams (in code blocks)

```
           +----------+
           | stopped  |
           +----+-----+
                | gt up
                v
           +----------+
           | starting |
           +----+-----+
                | agents ready
                v
           +---------+
      +----| running |----+
      |    +---------+    |
      | gt down           | gt up
      v                   |
+----------+              |
| stopping |              |
+----+-----+              |
     | agents stopped     |
     v                    |
+---------+               |
| stopped |<--------------+
+---------+
```

### Paragraph with Line Breaks

This is a paragraph with
a soft line break in the middle.
GFM treats newlines within paragraphs differently from standard Markdown.

This is a separate paragraph after a blank line.

---

## Section 11: Edge Cases and Stress Tests

### Escaped Characters

\*Not italic\* (escaped asterisks)
\*\*Not bold\*\* (escaped double asterisks)
\`Not code\` (escaped backticks)
\[Not a link\](url) (escaped brackets)
\# Not a heading (escaped hash)

### Empty Formatting

****  (empty bold)
**  (single bold marker)
``  (empty code)

### Deeply Nested Inline

***bold italic with `code` inside*** is complex.
**Bold text with *nested italic* inside** should work.

### Consecutive Formatting

**bold1** **bold2** **bold3** on the same line.
*italic1* *italic2* *italic3* on the same line.
`code1` `code2` `code3` on the same line.

### Unicode Content

| Emoji | Name | Category |
|-------|------|----------|
| Check | checkmark | Symbol |
| Warning | warning | Alert |
| Star | star | Rating |

### Very Long Lines

This is a very long line that should wrap properly in the iOS view without causing horizontal scroll or layout issues. It contains a mix of **bold**, *italic*, `code`, and [links](https://example.com) to stress-test inline formatting across line wraps in constrained widths typical of mobile devices.

### Table Followed Immediately by List (no blank line)

| A | B |
|---|---|
| 1 | 2 |
- List item right after table
- Another item

### Heading Followed Immediately by Table (no blank line)

#### Status Matrix
| Status | Description |
|--------|-------------|
| open | Ready for work |
| closed | Complete |

### Indented Code Block (4 spaces)

    This is an indented code block.
    It uses 4 spaces instead of fences.
    Many Markdown parsers support this.

### Image Reference (not expected to render, but should not crash)

![Alt text](https://example.com/image.png)
![](https://example.com/no-alt.png)

### HTML Tags (should pass through or be stripped, not crash)

<details>
<summary>Click to expand</summary>

This is hidden content inside an HTML details tag.

</details>

<div style="color: green;">Inline HTML div</div>

### Definition Lists (not standard, but some parsers support)

Term 1
: Definition of term 1

Term 2
: Definition of term 2

### Footnotes (GFM extension)

This has a footnote[^1] reference.

[^1]: This is the footnote content.

### Consecutive Blank Lines (should collapse)



Multiple blank lines above should not produce extra spacing.

### Trailing Whitespace

This line has trailing spaces
This line uses backslash for line break\
Normal line.

---

## Section 12: Real Spec File Patterns

### Pattern: Acceptance Criteria List

**Acceptance Criteria:**
- AC1.1: Each message in MailDetail has a voice playback button
- AC1.2: Audio is synthesized using ElevenLabs TTS API
- AC1.3: Different agents have distinct voice identities
- AC1.4: Audio player shows progress indicator
- AC1.5: Audio can be paused/stopped mid-playback
- AC1.6: Generated audio is cached to avoid re-synthesis

### Pattern: Given/When/Then Scenarios

1. **Given** the user opens the mail interface, **When** messages exist, **Then** a list appears sorted by newest first
2. **Given** a message list is displayed, **When** the user selects a message, **Then** full content appears in the right panel
3. **Given** the user has drafted a message, **When** they click "Send", **Then** the message is transmitted

### Pattern: Requirement IDs

- **FR-001**: System MUST display incoming messages in a scrollable list view
- **FR-002**: System MUST display selected message content in a detail panel
- **SC-001**: Voice playback works for any message within 3 seconds
- **SC-002**: Voice input transcription accuracy > 90% for English

### Pattern: Task Checklist from tasks.md

- [ ] T001 Create monorepo structure with backend/ and frontend/ directories
- [ ] T002 Initialize backend Node.js project with TypeScript
- [ ] T003 [P] Configure ESLint and Prettier for backend
- [ ] T004 [P] [US1] Write unit tests for mail-service
- [x] T005 Implement mail-service with listMail, getMessage

### Pattern: Dependency Table

| Module | Can Import From | Cannot Import From |
|--------|----------------|-------------------|
| index.ts | repository, filter, dependency, sorter, types | bd-client |
| beads-repository.ts | bd-client, types | filter, dependency, sorter |
| beads-filter.ts | types | bd-client, repository, dependency, sorter |
| beads-sorter.ts | types | bd-client, repository, filter, dependency |
| types.ts | (none -- leaf module) | everything |

### Pattern: State Flow Diagram in Code Block

```
open --[assign agent]--> in_progress
in_progress --[reassign]--> in_progress (no status change)
in_progress --[unassign]--> in_progress (only assignee cleared)
```

### Pattern: API Contract

**Request:**
```json
{
  "text": "Message content to synthesize",
  "voiceId": "optional-voice-id",
  "agentId": "optional-agent-for-voice-lookup"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "audioUrl": "/api/voice/audio/abc123.mp3",
    "duration": 5.2,
    "cached": false
  }
}
```

---

## End of Test Document

If you can read this final line, the parser successfully processed the entire document
without crashing or entering an infinite loop. All sections above should be visually
distinct and properly formatted.
