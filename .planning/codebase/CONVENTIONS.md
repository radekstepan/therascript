# Conventions

## Code Style

### Formatting (Prettier)

Configuration in `.prettierrc`:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "tabWidth": 2,
  "useTabs": false
}
```

**Enforced via:**

- Pre-commit hook (Husky + lint-staged)
- `yarn format` command

### TypeScript

**Strict Mode:** Enabled globally

```json
{
  "strict": true,
  "skipLibCheck": true,
  "forceConsistentCasingInFileNames": true,
  "esModuleInterop": true,
  "target": "ES2022",
  "moduleResolution": "NodeNext"
}
```

**Key conventions:**

- Explicit return types on exported functions
- Type imports separated (`import type { ... }`)
- No implicit `any` (strict mode)
- Decorators enabled for Elysia/TypeBox
- Composite projects enabled for build references

### Import Organization

**Standard order:**

1. Node.js built-ins (`node:fs`, `node:path`)
2. External packages (`elysia`, `axios`, `react`)
3. Internal packages (`@therascript/*`)
4. Relative imports (`./routes`, `../services`)

**Example:**

```typescript
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { Elysia, t } from 'elysia';
import axios from 'axios';

import config from '@therascript/config';
import { db } from '@therascript/db';

import { sessionRoutes } from './routes/sessionRoutes.js';
```

**Note:** Relative imports include `.js` extension (ESM requirement).

## Error Handling

### Custom Error Classes

Location: `packages/api/src/errors.ts`

**Hierarchy:**

```typescript
class ApiError extends Error {
  status: number;
  name: string;
  details?: string;
}

class BadRequestError extends ApiError        // 400
class NotFoundError extends ApiError          // 404
class ConflictError extends ApiError          // 409
class InternalServerError extends ApiError    // 500
```

**Usage pattern:**

```typescript
throw new NotFoundError('Session not found');
throw new BadRequestError('Invalid input', details);
```

### Global Error Handler

Elysia's `onError` middleware in `server.ts`:

1. Catches `ApiError` subclasses → returns structured JSON
2. Handles Elysia validation errors → 400
3. Handles SQLite constraint violations → 409
4. Falls back to 500 for unknown errors

**Error logging:**

```typescript
console.error(
  `[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`
);
```

### Try-Catch Patterns

**Service layer:**

```typescript
try {
  await someOperation();
} catch (err) {
  console.error('[ServiceName] Error description:', err);
  throw new InternalServerError('User-friendly message');
}
```

**Startup initialization:**

```typescript
async function initializeServices() {
  try {
    await checkOllamaConnectionOnStartup();
    await initializeElasticsearch();
  } catch (initError) {
    console.error('Failed to initialize services:', initError);
    process.exit(1);
  }
}
```

## Naming Conventions

### Files

| Type              | Convention      | Example                        |
| ----------------- | --------------- | ------------------------------ |
| TypeScript source | camelCase.ts    | `sessionRoutes.ts`             |
| React components  | PascalCase.tsx  | `SessionView.tsx`              |
| Test files        | source.test.ts  | `errors.test.ts`               |
| Config files      | kebab-case.json | `tsconfig.base.json`           |
| Docker files      | Pascalfile      | `Dockerfile`, `Dockerfile.gpu` |

### Variables & Functions

| Type            | Convention            | Example               |
| --------------- | --------------------- | --------------------- |
| Variables       | camelCase             | `sessionRepository`   |
| Constants       | UPPER_SNAKE_CASE      | `TRANSCRIPTION_QUEUE` |
| Functions       | camelCase             | `createSession()`     |
| Private members | \_camelCase           | `_insertSessionStmt`  |
| Async functions | camelCase (no suffix) | `fetchTranscript()`   |

### Types & Interfaces

| Type           | Convention            | Example          |
| -------------- | --------------------- | ---------------- |
| Interfaces     | PascalCase            | `BackendSession` |
| Type aliases   | PascalCase            | `SessionRow`     |
| Zod schemas    | camelCase + Schema    | `sessionSchema`  |
| Request types  | PascalCase + Request  | `SessionRequest` |
| Response types | PascalCase + Response | `ChatResponse`   |

### React Components

| Type        | Convention       | Example               |
| ----------- | ---------------- | --------------------- |
| Components  | PascalCase       | `UploadModal`         |
| Hooks       | use + camelCase  | `useMessageStream`    |
| Atoms       | camelCase + Atom | `activeSessionIdAtom` |
| CSS classes | kebab-case       | `session-list-table`  |

## Patterns

### Repository Pattern

**Structure:**

```typescript
// Cached prepared statements
let _insertStmt: DbStatement | null = null;
const insertStmt = (): DbStatement => {
  if (!_insertStmt) {
    _insertStmt = db.prepare('INSERT INTO ...');
  }
  return _insertStmt;
};

// Repository object
export const sessionRepository = {
  create: (params) => {
    const stmt = insertStmt();
    const result = stmt.run(...params);
    return mapToDomain(result);
  },
  findById: (id) => { ... },
  update: (id, data) => { ... },
  delete: (id) => { ... },
};
```

**Key characteristics:**

- Prepared statements cached for performance
- Raw SQL with parameterized queries
- Domain type mapping on return
- No ORM abstraction

### Service Pattern

**Structure:**

```typescript
export const transcriptionService = {
  submitJob: async (sessionId, numSpeakers) => {
    // Business logic
    await queue.add('transcription', { sessionId });
  },
  getStatus: async (jobId) => {
    // Status checking
  },
};
```

**Key characteristics:**

- Stateless functions grouped by domain
- No internal state (except caches)
- Async/await for I/O operations
- Error handling with custom errors

### Route Definitions

**Structure:**

```typescript
export const sessionRoutes = new Elysia({ prefix: '/api/sessions' })
  .get('/', async () => {
    return sessionRepository.findAll();
  })
  .post('/', async ({ body }) => {
    return sessionRepository.create(body);
  })
  .get('/:id', async ({ params }) => {
    return sessionRepository.findById(params.id);
  });
```

**Key characteristics:**

- Grouped by domain with prefix
- Direct repository calls (thin routes)
- Validation via Zod schemas
- Swagger tags for documentation

### React Component Structure

**Structure:**

```typescript
interface Props {
  sessionId: number;
  onEdit?: () => void;
}

export function SessionView({ sessionId, onEdit }: Props) {
  // Hooks
  const { data } = useQuery({ ... });
  const [isOpen, setIsOpen] = atom(false);

  // Event handlers
  const handleClick = () => { ... };

  // Render
  return ( ... );
}
```

**Key characteristics:**

- Functional components only
- TypeScript interfaces for props
- TanStack Query for server state
- Jotai atoms for UI state
- Radix UI for primitives

## Logging

### Console Logging Patterns

**Standard format:**

```typescript
[Component] Message: detail
```

**Examples:**

```typescript
console.log('[Server] Starting Elysia application...');
console.error('[TranscriptionProcessor] Job failed:', error);
console.warn('[GPU Service] No NVIDIA GPU detected');
```

**Component prefixes:**

- `[Server]` — API server
- `[Worker]` — Background worker
- `[SessionRepo]` — Session repository
- `[TranscriptionProcessor]` — Transcription job
- `[GPU Service]` — GPU monitoring
- `[CORS Config]` — CORS setup
- `[Error Handler]` — Error middleware

### Request Logging

**API server:**

```typescript
.onRequest(({ request }) => {
  console.log(`[Request] --> ${request.method} ${new URL(request.url).pathname}`);
})
.onAfterHandle(({ request, set }) => {
  console.log(`[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`);
});
```

## Testing

### Test Structure

**Framework:** Vitest
**Location:** Adjacent to source (`*.test.ts`)

**Pattern:**

```typescript
import { describe, it, expect } from 'vitest';
import { functionToTest } from './source';

describe('ModuleName', () => {
  it('should do something specific', () => {
    const result = functionToTest(input);
    expect(result).toEqual(expected);
  });
});
```

### Test Coverage

**Current coverage:**

- `packages/api/src/` — Services and errors
- `packages/db/src/` — Query wrappers
- `packages/data/src/repositories/` — Template repository
- `packages/domain/src/` — Validators
- `packages/services/src/` — Helpers and tokenizer
- `packages/elasticsearch-client/src/` — Client and utilities
- `packages/gpu-utils/src/` — GPU utils

**Not covered:**

- UI components (no UI tests)
- Route handlers
- Worker processors

## Git Conventions

### Branch Naming

- Feature branches: `feature/description`
- Bug fixes: `fix/description`
- Hotfixes: `hotfix/description`

### Commit Messages

- Conventional Commits format (enforced by Husky)
- Scoped to packages when relevant: `fix(api): resolve CORS issue`

### Pre-commit Hooks

- Prettier formatting (lint-staged)
- TypeScript compilation check
- Test suite (if configured)

## Environment Management

### Environment Files

| File               | Purpose                       |
| ------------------ | ----------------------------- |
| `.env`             | Root shared config (HF_TOKEN) |
| `.env.api.dev`     | API development               |
| `.env.api.mock`    | API mock mode                 |
| `.env.api.prod`    | API production                |
| `.env.worker.dev`  | Worker development            |
| `.env.worker.prod` | Worker production             |

### Configuration Access

```typescript
import config from '@therascript/config';

// Type-safe access
const dbPath = config.db.sqlitePath;
const isProd = config.server.isProduction;
```

## Documentation

### Code Documentation

- JSDoc comments for exported functions
- Inline comments for complex logic
- README files in each package

### Project Documentation

Located in `docs/`:

- `ARCHITECTURE.md` — System overview
- `COMPONENT_MAP.md` — Package details
- `NAVIGATION.md` — "Where to change what"
- `API_REFERENCE.md` — Endpoint documentation
- `DATA_FLOWS.md` — Operational workflows
- `SCHEMA_REFERENCE.md` — Database schema

### DEV_NOTES.md

Each package has a `DEV_NOTES.md` with package-specific development notes.

---

_Last updated: 2026-04-08 after codebase mapping_
