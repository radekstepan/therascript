# Testing

## Framework & Configuration

### Test Framework

- **Vitest** (`vitest@0.34.6`) — Unit testing framework
- **Configuration:** `vitest.config.ts` at root
- **Test files:** `*.test.ts` adjacent to source files

### Running Tests

```bash
# Run all tests
yarn test

# Watch mode
yarn test:watch

# With coverage
yarn coverage
```

### Test Location Pattern

Tests are colocated with source files:

```
packages/
├── api/src/
│   ├── errors.test.ts
│   └── services/
│       ├── llamaCppService.test.ts
│       ├── activeModelService.test.ts
│       └── contextUsageService.test.ts
├── db/src/
│   └── queryWrapper.test.ts
├── data/src/repositories/
│   └── templateRepository.test.ts
└── ...
```

## Test Coverage

### Covered Packages

| Package                  | Test Files | Coverage Focus                         |
| ------------------------ | ---------- | -------------------------------------- |
| **api**                  | 4 files    | Services, error handling               |
| **db**                   | 1 file     | Query wrapper utilities                |
| **data**                 | 1 file     | Template repository                    |
| **domain**               | 1 file     | Schema validators                      |
| **services**             | 2 files    | Helpers, tokenizer                     |
| **elasticsearch-client** | 5 files    | Client, search utils, index management |
| **gpu-utils**            | 1 file     | GPU stats parsing                      |

### Notable Test Files

#### API Services

- `packages/api/src/errors.test.ts` — Custom error classes
- `packages/api/src/services/llamaCppService.test.ts` — LM Studio client
- `packages/api/src/services/activeModelService.test.ts` — Model management
- `packages/api/src/services/contextUsageService.test.ts` — Token/usage tracking

#### Data Layer

- `packages/data/src/repositories/templateRepository.test.ts` — CRUD operations
- `packages/db/src/queryWrapper.test.ts` — Database query utilities

#### Domain

- `packages/domain/src/validators.test.ts` — Schema validation

#### Shared Services

- `packages/services/src/helpers.test.ts` — Utility functions
- `packages/services/src/tokenizerService.test.ts` — Token counting

#### Elasticsearch

- `packages/elasticsearch-client/src/client.test.ts` — ES client
- `packages/elasticsearch-client/src/searchUtils.test.ts` — Search utilities
- `packages/elasticsearch-client/src/initializeIndices.test.ts` — Index setup
- `packages/elasticsearch-client/src/ensureIndex.test.ts` — Index creation
- `packages/elasticsearch-client/src/deleteByQuery.test.ts` — Bulk deletion

#### GPU Utils

- `packages/gpu-utils/src/index.test.ts` — GPU stats parsing

## Test Patterns

### Unit Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { functionToTest } from './source';

describe('ModuleName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should handle specific case', () => {
    const result = functionToTest(input);
    expect(result).toEqual(expected);
  });

  it('should throw on invalid input', () => {
    expect(() => functionToTest(invalidInput)).toThrow();
  });
});
```

### Mocking Patterns

**External services:**

```typescript
vi.mock('@therascript/db', () => ({
  db: {
    prepare: vi.fn(),
    transaction: vi.fn(),
  },
}));
```

**HTTP clients:**

```typescript
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));
```

### Test Data

**Factories:** Not used — inline test data
**Fixtures:** Not used — hardcoded test cases
**Mocks:** Manual mocks via `vi.mock()`

## Testing Gaps

### Missing Test Coverage

#### API Layer

- **Route handlers** — No integration tests for endpoints
- **Middleware** — CORS, error handling not tested
- **Server initialization** — Startup sequence not tested

#### Worker Layer

- **Job processors** — Transcription and analysis processors not tested
- **Stream publisher** — Pub/Sub functionality not tested

#### UI Layer

- **Components** — No component tests
- **Hooks** — No hook tests
- **API client** — No mock API tests
- **State management** — No atom tests

#### Integration Tests

- **End-to-end flows** — No E2E tests
- **Service integration** — No integration tests with real services
- **Database integration** — No tests with real SQLite

### Testing Infrastructure

**Missing:**

- Test database (in-memory SQLite for tests)
- Mock service servers
- Component testing setup (React Testing Library)
- E2E testing framework (Playwright, Cypress)
- API integration tests (Supertest)

## Test Quality

### Strengths

- **Good coverage of utilities** — Helpers, validators, query wrappers
- **Elasticsearch client** — Well-tested client and search utilities
- **Service layer** — Core services have tests
- **Error handling** — Custom error classes tested

### Weaknesses

- **No integration tests** — Only unit tests for isolated functions
- **No UI tests** — Frontend completely untested
- **No worker tests** — Background job processors untested
- **No route tests** — API endpoints untested
- **Limited mocking** — Manual mocks can drift from real implementations

## Recommendations

### Immediate Priorities

1. **Add route integration tests** — Test API endpoints with mock data
2. **Add worker unit tests** — Test job processors in isolation
3. **Add component smoke tests** — Basic rendering tests for UI
4. **Add test database** — In-memory SQLite for data layer tests

### Medium-term Improvements

1. **Add E2E tests** — Critical user flows (upload, transcribe, chat)
2. **Add API contract tests** — Verify Swagger docs match implementation
3. **Add load tests** — Performance testing for transcription pipeline
4. **Improve mocking** — Use MSW for API mocking

### Long-term Goals

1. **Achieve 80%+ coverage** — Focus on business logic
2. **Add visual regression tests** — UI consistency
3. **Add performance tests** — Benchmark critical paths
4. **Add chaos tests** — Resilience testing for distributed services

## Running Tests in CI

**Current setup:** No CI configuration visible
**Recommended:**

```yaml
# GitHub Actions example
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 23
      - run: yarn install
      - run: yarn build
      - run: yarn test
      - run: yarn coverage
```

## Test Commands Reference

```bash
# Run all tests
yarn test

# Run specific package tests
yarn vitest run packages/api

# Watch mode
yarn test:watch

# Run with coverage
yarn coverage

# Run specific test file
yarn vitest run packages/api/src/errors.test.ts

# Update snapshots
yarn vitest -u
```

---

_Last updated: 2026-04-08 after codebase mapping_
