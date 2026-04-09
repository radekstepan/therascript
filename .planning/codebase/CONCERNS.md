# Concerns

## Technical Debt

### 3. No Database Migration System

**Severity:** Medium  
**Location:** `packages/db/`

**Issue:**

- No visible migration framework (e.g., `knex`, `db-migrate`)
- Schema changes likely manual or ad-hoc
- `upgrade-db.js` script exists but implementation unknown

**Impact:**

- Risk of schema drift between environments
- Difficult to track schema history
- Manual upgrades error-prone

**Recommendation:**

- Implement proper migration system (e.g., `knex` migrations)
- Version all schema changes
- Add migration rollback capability

### 4. Hardcoded SQL Queries

**Severity:** Low  
**Location:** `packages/data/src/repositories/`

**Issue:**

- Raw SQL strings in repository implementations
- No query builder abstraction
- Schema changes require manual SQL updates

**Impact:**

- Typos in SQL only caught at runtime
- Refactoring schema is risky
- No compile-time query validation

**Recommendation:**

- Consider query builder (e.g., `kysely`, `knex`)
- Add runtime query validation
- Improve test coverage for repositories

## Code Quality Issues

### 5. Inconsistent Error Handling

**Severity:** Medium  
**Location:** Throughout codebase

**Issue:**

- Mix of custom `ApiError` classes and generic `Error`
- Some services catch and log, others propagate
- Inconsistent error message formatting

**Examples:**

```typescript
// Pattern 1: Custom error
throw new NotFoundError('Session not found');

// Pattern 2: Generic error with console
console.error('[Service] Error:', err);
throw new Error('Something failed');

// Pattern 3: Silent failure
try { ... } catch (err) { /* logged but not thrown */ }
```

**Recommendation:**

- Standardize on custom error classes
- Create error handling guidelines
- Add error boundary tests

### 6. Large Server File

**Severity:** Low  
**Location:** `packages/api/src/server.ts` (540 lines)

**Issue:**

- Server entry point is monolithic
- All routes registered in single file
- Middleware configuration inline

**Impact:**

- Harder to understand startup sequence
- Merge conflicts likely in team settings
- Testing startup logic difficult

**Recommendation:**

- Extract route registration to separate module
- Create middleware configuration module
- Split startup initialization into separate file

### 7. Console Logging Everywhere

**Severity:** Low  
**Location:** Throughout codebase

**Issue:**

- Heavy use of `console.log`, `console.error`, `console.warn`
- No structured logging (e.g., `pino`, `winston`)
- No log levels configuration
- No log aggregation

**Impact:**

- Noisy output in production
- Difficult to filter/search logs
- No correlation IDs for request tracing

**Recommendation:**

- Introduce structured logger
- Configure log levels per environment
- Add request ID correlation
- Consider log aggregation (e.g., ELK stack)

## Architecture Concerns

### 8. Tight Coupling to Docker

**Severity:** Medium  
**Location:** `packages/api/src/services/dockerManagementService.ts`

**Issue:**

- API directly manages Docker containers via `dockerode`
- Tightly coupled to Docker-specific APIs
- Difficult to run without Docker

**Impact:**

- Deployment flexibility limited
- Testing requires Docker
- Local development more complex

**Recommendation:**

- Abstract container management behind interface
- Support alternative deployment methods
- Add Docker-less development mode

### 9. No Caching Layer

**Severity:** Low  
**Location:** Throughout codebase

**Issue:**

- No HTTP caching headers
- No response caching for expensive operations
- Repeated database queries for same data

**Impact:**

- Unnecessary database load
- Slower response times for repeated requests
- Wasted LLM token budget (re-processing same context)

**Recommendation:**

- Add HTTP caching headers (ETag, Last-Modified)
- Implement response caching for read-only endpoints
- Cache LLM responses where appropriate

### 10. Single SQLite Database

**Severity:** Low-Medium  
**Location:** `packages/db/`

**Issue:**

- All data in single SQLite file
- No read replicas
- No horizontal scaling path

**Impact:**

- Fine for single-user scenario
- Would require migration for multi-user deployment
- Backup/restore is file-level operation

**Recommendation:**

- Abstract database layer for future migration
- Consider PostgreSQL for multi-user scenarios
- Implement proper backup strategy

## Security Concerns

### 11. No Authentication/Authorization

**Severity:** High (if exposed)  
**Location:** API routes

**Issue:**

- No authentication middleware visible
- All endpoints appear unprotected
- Assumes local-only access

**Impact:**

- **Critical if exposed to internet**
- Acceptable for localhost-only deployment
- No audit trail for actions

**Recommendation:**

- Add authentication if exposing beyond localhost
- Implement role-based access control
- Add audit logging for sensitive operations
- Document security assumptions clearly

### 12. Environment Variable Exposure

**Severity:** Medium  
**Location:** `.env*` files

**Issue:**

- Multiple environment files increase leak risk
- `HF_TOKEN` in root `.env` file
- No secret rotation mechanism

**Impact:**

- Potential credential exposure
- Difficult to rotate secrets
- No secret versioning

**Recommendation:**

- Use Infisical consistently (already partially integrated)
- Remove hardcoded secrets from env files
- Implement secret rotation
- Add secret scanning to CI

### 13. File Upload Validation

**Severity:** Medium  
**Location:** `packages/api/src/routes/transcriptionRoutes.ts`

**Issue:**

- Audio file uploads need validation
- File type checking may be insufficient
- No file size limits visible
- Potential for malicious file uploads

**Impact:**

- Storage exhaustion
- Potential code execution via crafted files
- Whisper service crashes on invalid files

**Recommendation:**

- Validate file types strictly (MIME + extension)
- Enforce file size limits
- Scan uploads for malware
- Sandbox Whisper service

## Performance Concernes

### 14. Polling-Based Whisper Integration

**Severity:** Medium  
**Location:** `packages/worker/src/jobs/transcriptionProcessor.ts`

**Issue:**

- Worker polls Whisper API for job completion
- Inefficient use of resources
- Delayed response on completion

**Impact:**

- Increased latency for transcription completion
- Unnecessary HTTP requests
- Redis queue occupation during polling

**Recommendation:**

- Implement webhook callback from Whisper
- Use SSE for job progress
- Add exponential backoff to polling

### 15. No Pagination for Large Lists

**Severity:** Low  
**Location:** Session list, chat message endpoints

**Issue:**

- Session queries return all results
- No pagination visible in repository methods
- Will degrade with large datasets

**Impact:**

- Slow UI with many sessions
- Large memory usage
- Network bandwidth waste

**Recommendation:**

- Add pagination to list endpoints
- Implement cursor-based pagination
- Add UI pagination controls

### 16. Elasticsearch Index Growth

**Severity:** Low-Medium  
**Location:** `packages/elasticsearch-client/`

**Issue:**

- No index lifecycle management
- Indices grow unbounded
- No rollover strategy

**Impact:**

- Elasticsearch storage growth
- Query performance degradation over time
- No automatic cleanup

**Recommendation:**

- Implement index lifecycle management (ILM)
- Add index rollover strategy
- Configure retention policies

## Deployment Concerns

### 17. Platform-Specific GPU Support

**Severity:** Low  
**Location:** `docker-compose.gpu.yml`

**Issue:**

- GPU support only for Linux with NVIDIA
- macOS users get CPU-only Whisper
- No Metal GPU support for Whisper

**Impact:**

- Slow transcription on macOS
- Inconsistent user experience
- GPU resources underutilized on Mac

**Recommendation:**

- Investigate Metal support for Whisper
- Document performance expectations per platform
- Consider cloud transcription option

### 18. No Health Check Endpoints

**Severity:** Medium  
**Location:** API server

**Issue:**

- `/api/health` endpoint exists but scope unknown
- No comprehensive health check (DB, ES, Redis, Whisper)
- No readiness/liveness probes

**Impact:**

- Difficult to monitor system health
- Docker health checks may be insufficient
- No alerting on service degradation

**Recommendation:**

- Implement comprehensive health check endpoint
- Add readiness/liveness probes
- Integrate with monitoring system

### 19. Manual Database Backups

**Severity:** Medium  
**Location:** `packages/api/src/routes/systemRoutes.ts`

**Issue:**

- Backup/restore is manual user action
- No automated backup schedule
- No backup verification

**Impact:**

- Data loss risk if user doesn't backup
- Corrupted backups may go unnoticed
- No point-in-time recovery

**Recommendation:**

- Add automated backup scheduling
- Implement backup verification
- Support cloud backup storage
- Add point-in-time recovery

## Testing Concerns

### 20. No UI Tests

**Severity:** Medium  
**Location:** `packages/ui/`

**Issue:**

- Zero test coverage for React components
- No component tests
- No integration tests for user flows

**Impact:**

- UI regressions undetected
- Manual testing required for all changes
- Refactoring risk

**Recommendation:**

- Add React Testing Library
- Start with component smoke tests
- Add critical flow integration tests

### 21. No Integration Tests

**Severity:** Medium  
**Location:** Throughout codebase

**Issue:**

- Only unit tests for isolated functions
- No tests for component interactions
- No end-to-end tests

**Impact:**

- Integration bugs slip through
- Manual testing bottleneck
- Deployment confidence low

**Recommendation:**

- Add API integration tests (Supertest)
- Add E2E tests for critical flows
- Implement test database for integration tests

## Documentation Concerns

### 22. Outdated Documentation

**Severity:** Low  
**Location:** `docs/`, `README.md`

**Issue:**

- References to Ollama (migrated to LM Studio)
- Some docs may not reflect current architecture
- Setup instructions may be stale

**Impact:**

- Developer confusion
- Incorrect assumptions
- Wasted debugging time

**Recommendation:**

- Audit all documentation
- Update Ollama references
- Add documentation review to PR checklist

### 23. Missing API Versioning

**Severity:** Low  
**Location:** API routes

**Issue:**

- No API versioning visible
- Breaking changes affect all clients
- No deprecation strategy

**Impact:**

- Difficult to evolve API
- Client breakage on changes
- No migration path

**Recommendation:**

- Add API versioning (URL or header)
- Document breaking changes
- Implement deprecation policy

---

_Last updated: 2026-04-08 after codebase mapping_
