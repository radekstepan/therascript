# Therascript Navigation Guide

> **"Where to change what"** — A quick reference for developers and LLMs to locate code by feature area.

---

## API Layer (`packages/api/src/`)

### Entry Point
- [`server.ts`](../packages/api/src/server.ts) — Express app setup, middleware, route registration

### Routes (`/routes/*.ts`) — HTTP endpoint definitions
| File | Purpose |
|------|---------|
| `sessionRoutes.ts` | Session CRUD, file upload |
| `chatRoutes.ts` | Session-bound chat endpoints |
| `standaloneChatRoutes.ts` | Standalone chat (no session context) |
| `analysisRoutes.ts` | Multi-session analysis jobs |
| `transcriptionRoutes.ts` | Transcription status, polling |
| `searchRoutes.ts` | Elasticsearch search endpoints |
| `ollamaRoutes.ts` | Model management (list, load, unload) |
| `templateRoutes.ts` | Prompt template CRUD |
| `systemRoutes.ts` | System prompts management |
| `jobsRoutes.ts` | Background job status |
| `dockerRoutes.ts` | Docker container management |
| `adminRoutes.ts` | Admin/debug endpoints |
| `metaRoutes.ts` | Health checks, readiness |

### Handlers (`/api/*.ts`) — Business logic for complex operations
| File | Purpose |
|------|---------|
| `sessionHandler.ts` | Session creation, deletion logic |
| `sessionChatHandler.ts` | RAG chat with transcript context |
| `standaloneChatHandler.ts` | General-purpose chat (no context) |
| `analysisHandler.ts` | Strategy generation, MapReduce orchestration |
| `templateHandler.ts` | Template management logic |
| `jobsHandler.ts` | Job queue operations |
| `gpuHandler.ts` | GPU availability checks |
| `metaHandler.ts` | System metadata, readiness |
| `adminHandler.ts` | Admin operations |

### Services (`/services/*.ts`) — External integrations & utilities
| File | Purpose |
|------|---------|
| `ollamaService.ts` | LLM inference (facade for mock/real) |
| `ollamaService.real.ts` | Actual Ollama API client |
| `ollamaService.mock.ts` | Mock for testing |
| `ollamaRuntime.ts` | Model lifecycle management |
| `activeModelService.ts` | Track currently loaded model |
| `transcriptionService.ts` | Whisper integration (facade) |
| `transcriptionService.real.ts` | Actual Whisper API client |
| `fileService.ts` | Audio file handling, storage |
| `jobQueueService.ts` | BullMQ job submission |
| `analysisJobService.ts` | Analysis job orchestration |
| `dockerManagementService.ts` | Container start/stop |
| `gpuService.ts` | GPU detection |
| `tokenizerService.ts` | Token counting |
| `contextUsageService.ts` | Context window tracking |
| `streamSubscriber.ts` | Redis pub/sub for streaming |
| `redisConnection.ts` | Redis client singleton |

### Repositories (`/repositories/*.ts`) — Database access patterns
| File | Purpose |
|------|---------|
| `sessionRepository.ts` | Sessions table operations |
| `chatRepository.ts` | Chats table operations |
| `messageRepository.ts` | Messages table operations |
| `transcriptRepository.ts` | Transcript paragraphs + ES queries |
| `analysisRepository.ts` | Analysis jobs table operations |
| `templateRepository.ts` | Templates table operations |

---

## Worker (`packages/worker/src/`)

### Entry Point
- [`index.ts`](../packages/worker/src/index.ts) — BullMQ worker initialization, queue setup

### Job Processors (`/jobs/*.ts`)
| File | Purpose |
|------|---------|
| `transcriptionProcessor.ts` | "The Ears" — Whisper job processing, ES indexing |
| `analysisProcessor.ts` | "The Analyst" — MapReduce analysis execution |

### Services (`/services/*.ts`)
| File | Purpose |
|------|---------|
| `streamPublisher.ts` | Redis pub/sub for real-time streaming to UI |

### Other Files
| File | Purpose |
|------|---------|
| `redisConnection.ts` | Redis client for BullMQ |
| `types.ts` | Worker-specific type definitions |

---

## UI (`packages/ui/src/`)

### Entry Points
- [`index.tsx`](../packages/ui/src/index.tsx) — React DOM render
- [`App.tsx`](../packages/ui/src/App.tsx) — Root component, routing, theme, layout

### Routes (defined in `App.tsx`)
| Path | Component |
|------|-----------|
| `/` | `LandingPage` |
| `/sessions/:sessionId` | `SessionView` |
| `/sessions/:sessionId/chats/:chatId` | `SessionView` |
| `/chats/:chatId` | `StandaloneChatView` |
| `/sessions-list` | `SessionsPage` |
| `/chats-list` | `StandaloneChatsPage` |
| `/templates` | `TemplatesPage` |
| `/analysis-jobs` | `AnalysisJobsPage` |
| `/settings` | `SettingsPage` |

### Pages (`/components/*.tsx`)
| File | Purpose |
|------|---------|
| `SessionsPage.tsx` | Sessions list view |
| `StandaloneChatsPage.tsx` | Standalone chats list |
| `SettingsPage.tsx` | App settings |
| `TemplatesPage.tsx` | Prompt templates management |
| `SystemPromptsPage.tsx` | System prompts editor |

### Feature Components (`/components/{Feature}/`)
| Directory | Purpose |
|-----------|---------|
| `Analysis/` | Analysis jobs UI, `AnalysisJobsPage.tsx` |
| `SessionView/` | Session detail, chat, transcript display |
| `StandaloneChatView/` | Standalone chat interface |
| `Search/` | Search UI components |
| `Transcription/` | Transcription progress, display |
| `UploadModal/` | File upload modal |
| `Layout/` | Sidebar, toolbar, background |
| `LandingPage/` | Home/landing page |
| `Shared/` | Reusable UI components |
| `Jobs/` | Job status components |
| `User/` | User-related components |

### API Clients (`/api/*.ts`) — Typed API wrappers
| File | Purpose |
|------|---------|
| `api.ts` | Base axios configuration |
| `session.ts` | Session API calls |
| `chat.ts` | Chat API calls |
| `analysis.ts` | Analysis job API calls |
| `search.ts` | Search API calls |
| `ollama.ts` | Model management API |
| `transcription.ts` | Transcription API |
| `templates.ts` | Templates API |
| `system.ts` | System prompts API |
| `jobs.ts` | Jobs API |
| `docker.ts` | Docker management API |
| `meta.ts` | Health/readiness API |

### React Hooks (`/hooks/*.ts`)
| File | Purpose |
|------|---------|
| `useMessageStream.ts` | SSE streaming for chat messages |
| `useAnalysisStream.ts` | SSE streaming for analysis results |
| `useAnimatedText.tsx` | Text animation effects |

### State Management (`/store/*.ts`) — Jotai atoms
| Directory/File | Purpose |
|----------------|---------|
| `action/` | Action-related atoms |
| `chat/` | Chat state atoms |
| `navigation/` | Navigation state (currentPageAtom) |
| `session/` | Session state atoms |
| `ui/` | UI state (sidebar, theme, modals) |
| `analysisJobSortCriteriaAtom.ts` | Analysis sorting state |
| `standaloneChatSortCriteriaAtom.ts` | Chat sorting state |

---

## Shared Packages

### Database (`packages/db/src/`)
| File | Purpose |
|------|---------|
| `sqliteService.ts` | Schema definition, migrations, system prompt templates |
| `config.ts` | Database path configuration |
| `types.ts` | Database type definitions |

### Elasticsearch (`packages/elasticsearch-client/src/`)
| File | Purpose |
|------|---------|
| `mappings.ts` | Index mappings (therascript_transcripts) |
| `client.ts` | ES client singleton |
| `searchUtils.ts` | Search query builders |

---

## Common Tasks Quick Reference

| Task | Where to Change |
|------|-----------------|
| **Add new API endpoint** | 1. `packages/api/src/routes/*.ts` (define route)<br>2. `packages/api/src/api/*.ts` (add handler if complex) |
| **Add new SQLite table** | `packages/db/src/sqliteService.ts` (schema + add migration in `runMigrations()`) |
| **Add new ES index** | `packages/elasticsearch-client/src/mappings.ts` |
| **Add new background job** | 1. `packages/worker/src/jobs/*.ts` (processor)<br>2. `packages/api/src/services/jobQueueService.ts` (queue submission) |
| **Modify system prompts** | `packages/db/src/sqliteService.ts` (`SYSTEM_PROMPT_TEMPLATES`) |
| **Add new UI page** | 1. `packages/ui/src/components/*.tsx` (page component)<br>2. `packages/ui/src/App.tsx` (add route) |
| **Add new API client** | `packages/ui/src/api/*.ts` |
| **Add new Jotai atom** | `packages/ui/src/store/*.ts` |
| **Add new React hook** | `packages/ui/src/hooks/*.ts` |
| **Add new repository** | `packages/api/src/repositories/*.ts` |
| **Add new service** | `packages/api/src/services/*.ts` |

---

## Key Files Summary

```
packages/
├── api/src/
│   ├── server.ts              # API entry point
│   ├── routes/*.ts            # HTTP endpoints
│   ├── api/*.ts               # Business logic handlers
│   ├── services/*.ts          # External integrations
│   └── repositories/*.ts      # Database access
├── worker/src/
│   ├── index.ts               # Worker entry point
│   └── jobs/*.ts              # Job processors
├── ui/src/
│   ├── App.tsx                # UI entry + routing
│   ├── components/*.tsx       # Pages
│   ├── components/{Feature}/  # Feature components
│   ├── api/*.ts               # API clients
│   ├── hooks/*.ts             # React hooks
│   └── store/*.ts             # Jotai state
├── db/src/
│   └── sqliteService.ts       # Schema + prompts
└── elasticsearch-client/src/
    └── mappings.ts            # ES index definitions
```
