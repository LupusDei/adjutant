# Quickstart: CLI Launcher Development

**Feature**: 002-cli-launcher
**Prerequisites**: Node.js 18+, npm, gastown installed

## 1. Setup CLI Package

```bash
# From repository root
mkdir -p cli/src/{commands,services,types,utils}
cd cli

# Initialize package.json
npm init -y

# Install dependencies
npm install commander open
npm install -D typescript vitest @types/node

# Create tsconfig.json
cat > tsconfig.json << 'TSEOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
TSEOF

# Update package.json for ESM
npm pkg set type=module
npm pkg set main=dist/index.js
npm pkg set bin.gt-boy=dist/index.js
npm pkg set scripts.build="tsc"
npm pkg set scripts.dev="tsc --watch"
npm pkg set scripts.test="vitest"
```

## 2. Create Entry Point

```bash
# Create cli/src/index.ts
cat > src/index.ts << 'TSEOF'
#!/usr/bin/env node
import { Command, Option } from 'commander';
import { startCommand } from './commands/start.js';

const program = new Command()
  .name('gt-boy')
  .description('Launch gastown-boy from a gastown directory')
  .version('1.0.0')
  .addOption(new Option('-p, --port <number>', 'frontend server port').default(5173).env('GT_BOY_PORT'))
  .addOption(new Option('-b, --backend-port <number>', 'backend API server port').default(3001).env('GT_BOY_BACKEND_PORT'))
  .addOption(new Option('--no-browser', 'skip opening browser automatically'))
  .action(startCommand);

program.parse();
TSEOF
```

## 3. Run Tests First (TDD)

```bash
# Create test file
cat > tests/unit/gastown-detector.test.ts << 'TSEOF'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectGastownDirectory } from '../../src/services/gastown-detector.js';
import fs from 'fs/promises';

vi.mock('fs/promises');

describe('detectGastownDirectory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return valid=true for directory with .beads/', async () => {
    // Arrange
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    
    // Act
    const result = await detectGastownDirectory('/path/to/town');
    
    // Assert
    expect(result.isValid).toBe(true);
  });

  it('should return valid=false and error for non-gastown directory', async () => {
    // Arrange
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    
    // Act
    const result = await detectGastownDirectory('/path/to/regular');
    
    // Assert
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Not a gastown directory');
  });
});
TSEOF

# Run tests (should fail - TDD red phase)
npm test
```

## 4. Implement Services

Implement in this order:
1. `gastown-detector.ts` - Make tests pass
2. `port-checker.ts` - Port availability checking
3. `process-manager.ts` - Child process lifecycle
4. `logger.ts` - Terminal output formatting

## 5. Build and Link

```bash
# Build TypeScript
npm run build

# Link globally for testing
npm link

# Test from a gastown directory
cd ~/gt/my-project
gt-boy --help
```

## 6. Verify Exit Codes

```bash
# Test error cases
cd /tmp
gt-boy
echo "Exit code: $?"  # Should be 1 (NOT_GASTOWN_DIR)

# Test success case
cd ~/gt/my-project
gt-boy
# Press Ctrl+C
echo "Exit code: $?"  # Should be 0
```

## Key Files to Create

| File | Purpose | Test File |
|------|---------|-----------|
| `src/index.ts` | CLI entry point | N/A (integration) |
| `src/commands/start.ts` | Main start command | N/A (calls services) |
| `src/services/gastown-detector.ts` | Detect gastown directory | `gastown-detector.test.ts` |
| `src/services/port-checker.ts` | Check port availability | `port-checker.test.ts` |
| `src/services/process-manager.ts` | Manage server processes | `process-manager.test.ts` |
| `src/utils/logger.ts` | Terminal output | N/A (simple) |
| `src/types/index.ts` | Type definitions | N/A |

## Common Issues

### ESM Import Extensions
TypeScript with ESM requires `.js` extensions in imports:
```typescript
// Wrong
import { foo } from './services/foo';

// Correct
import { foo } from './services/foo.js';
```

### commander.js Version
Use commander v12+ for full TypeScript and ESM support.

### open Package
The `open` package is ESM-only. Ensure `"type": "module"` in package.json.
