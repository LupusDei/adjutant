# Speckit Workflow

## Feature Development Process

This project uses speckit for structured feature development:

1. `/speckit.constitution` - Define project principles (done)
2. `/speckit.specify` - Create feature specification
3. `/speckit.clarify` - Resolve ambiguities
4. `/speckit.plan` - Generate implementation plan
5. `/speckit.tasks` - Create task breakdown
6. `/speckit.beads` - Generate beads for orchestration
7. `/speckit.implement` - Execute tasks

## Feature Artifacts

Each feature lives in `specs/###-feature-name/`:

```
specs/001-pipboy-ui/
├── spec.md           # What to build (user stories, requirements)
├── plan.md           # How to build (tech decisions, structure)
├── research.md       # Investigation results
├── data-model.md     # Types and schemas
├── contracts/        # OpenAPI specs
├── quickstart.md     # Setup guide
├── tasks.md          # Implementation tasks
└── beads-import.md   # Beads orchestration data
```

## Task Format

Tasks in tasks.md follow this format:
```
- [ ] T001 [P] [US1] Description in path/to/file.ts
```

- `T001` - Sequential task ID
- `[P]` - Can run in parallel
- `[US1]` - Belongs to User Story 1
- Path at end of description

## User Story Independence

Each user story should be:
- Independently implementable
- Independently testable
- Deliverable as MVP increment
