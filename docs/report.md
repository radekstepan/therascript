## 4. Low Priority Issues

### 4.2 🟢 Verbose Console Logging

**Problem:** Extensive `console.log` throughout codebase. For a local single-tenant app this is acceptable, but makes log output noisy.

**Recommendation:** Consider a structured logger (pino, winston) with log levels if the application grows.

---

### 4.3 🟢 Missing Analysis Processor Timeout

**Location:** [`packages/worker/src/jobs/analysisProcessor.ts`](file:///Users/radek/dev/therascript/packages/worker/src/jobs/analysisProcessor.ts)

**Problem:** No overall timeout for analysis jobs. A job analyzing many sessions could run for hours.

**Recommendation:** Add configurable job-level timeout (e.g., 30 minutes) and BullMQ job options.
