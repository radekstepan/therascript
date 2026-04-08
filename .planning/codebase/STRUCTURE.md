# Structure

## Directory Layout

```
therascript/
├── .planning/                  # GSD planning documents
│   └── codebase/               # Codebase mapping output
│
├── packages/                   # Monorepo packages
│   ├── api/                    # ElysiaJS backend server
│   │   ├── src/
│   │   │   ├── api/            # API handlers (chat, analysis)
│   │   │   │   ├── analysisHandler.ts
│   │   │   │   └── sessionChatHandler.ts
│   │   │   ├── middleware/     # Elysia middleware
│   │   │   ├── preload-data/   # Database seeding
│   │   │   ├── routes/         # Route definitions
│   │   │   │   ├── sessionRoutes.ts
│   │   │   │   ├── chatRoutes.ts
│   │   │   │   ├── analysisRoutes.ts
│   │   │   │   ├── transcriptionRoutes.ts
│   │   │   │   ├── llmRoutes.ts
│   │   │   │   ├── dockerRoutes.ts
│   │   │   │   ├── systemRoutes.ts
│   │   │   │   ├── searchRoutes.ts
│   │   │   │   ├── jobsRoutes.ts
│   │   │   │   ├── templateRoutes.ts
│   │   │   │   ├── usageRoutes.ts
│   │   │   │   ├── metaRoutes.ts
│   │   │   │   └── adminRoutes.ts
│   │   │   ├── services/       # Business logic services
│   │   │   │   ├── activeModelService.ts
│   │   │   │   ├── analysisJobService.ts
│   │   │   │   ├── jobQueueService.ts
│   │   │   │   ├── transcriptionService.ts
│   │   │   │   ├── dockerManagementService.ts
│   │   │   │   ├── gpuService.ts
│   │   │   │   ├── llamaCppService.ts
│   │   │   │   ├── llamaCppRuntime.ts
│   │   │   │   ├── contextUsageService.ts
│   │   │   │   └── streamSubscriber.ts
│   │   │   ├── types/          # TypeScript types
│   │   │   ├── server.ts       # Main entry point
│   │   │   ├── errors.ts       # Custom error classes
│   │   │   └── preloadDb.ts    # Database seeding script
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── worker/                 # Background job processor
│   │   ├── src/
│   │   │   ├── jobs/           # Job processors
│   │   │   │   ├── transcriptionProcessor.ts
│   │   │   │   └── analysisProcessor.ts
│   │   │   ├── services/       # Worker services
│   │   │   │   └── streamPublisher.ts
│   │   │   ├── index.ts        # Main entry point
│   │   │   └── types.ts        # TypeScript types
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui/                     # React frontend
│   │   ├── src/
│   │   │   ├── api/            # API client functions
│   │   │   │   ├── api.ts      # Axios instance
│   │   │   │   ├── session.ts
│   │   │   │   ├── chat.ts
│   │   │   │   ├── analysis.ts
│   │   │   │   ├── transcription.ts
│   │   │   │   ├── llm.ts
│   │   │   │   ├── docker.ts
│   │   │   │   ├── system.ts
│   │   │   │   ├── search.ts
│   │   │   │   ├── jobs.ts
│   │   │   │   ├── templates.ts
│   │   │   │   ├── usage.ts
│   │   │   │   └── meta.ts
│   │   │   ├── components/     # React components
│   │   │   │   ├── LandingPage/
│   │   │   │   ├── SessionView/
│   │   │   │   ├── StandaloneChatView/
│   │   │   │   ├── Analysis/
│   │   │   │   ├── Transcription/
│   │   │   │   ├── Layout/
│   │   │   │   ├── Shared/
│   │   │   │   ├── User/
│   │   │   │   ├── Jobs/
│   │   │   │   └── Search/
│   │   │   ├── store/          # Jotai atoms
│   │   │   │   ├── ui/         # UI state
│   │   │   │   ├── session/    # Session state
│   │   │   │   ├── chat/       # Chat state
│   │   │   │   └── action/     # Action atoms
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   │   ├── useMessageStream.ts
│   │   │   │   ├── useAnalysisStream.ts
│   │   │   │   └── useAnimatedText.tsx
│   │   │   ├── App.tsx         # Root component
│   │   │   └── index.tsx       # Entry point
│   │   ├── webpack.config.js
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   ├── db/                     # Database layer
│   │   ├── src/
│   │   │   ├── sqliteService.ts
│   │   │   ├── queryWrapper.ts
│   │   │   ├── schemaValidation.ts
│   │   │   ├── config.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── domain/                 # Domain schemas
│   │   ├── src/
│   │   │   ├── schemas/
│   │   │   │   ├── db/         # DB entity schemas
│   │   │   │   ├── api/        # API request schemas
│   │   │   │   └── jobs/       # Job payload schemas
│   │   │   ├── validators.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── data/                   # Data access layer
│   │   ├── src/
│   │   │   ├── repositories/   # Repository implementations
│   │   │   │   ├── sessionRepository.ts
│   │   │   │   ├── messageRepository.ts
│   │   │   │   ├── transcriptRepository.ts
│   │   │   │   ├── chatRepository.ts
│   │   │   │   ├── templateRepository.ts
│   │   │   │   ├── analysisRepository.ts
│   │   │   │   └── usageRepository.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── config/                 # Configuration
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── pricing.ts
│   │   └── package.json
│   │
│   ├── queue/                  # Queue definitions
│   │   ├── src/
│   │   │   ├── connection.ts
│   │   │   ├── types.ts
│   │   │   ├── constants.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── services/               # Shared services
│   │   ├── src/
│   │   │   ├── llamaCppClient.ts
│   │   │   ├── fileService.ts
│   │   │   ├── tokenizerService.ts
│   │   │   ├── helpers.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── elasticsearch-client/   # ES client wrapper
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── mappings.ts
│   │   │   ├── searchUtils.ts
│   │   │   ├── initializeIndices.ts
│   │   │   ├── ensureIndex.ts
│   │   │   ├── deleteByQuery.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── whisper/                # Python transcription service
│   │   ├── src/
│   │   │   ├── server.ts       # TypeScript build manager
│   │   │   ├── routes.ts
│   │   │   ├── jobManager.ts
│   │   │   ├── dockerManager.ts
│   │   │   └── types.ts
│   │   ├── transcribe.py       # Python transcription script
│   │   ├── whisper_api.py      # FastAPI server
│   │   ├── Dockerfile
│   │   ├── Dockerfile.gpu
│   │   └── requirements.txt
│   │
│   ├── llama/                  # LM Studio backend
│   │   └── (setup scripts)
│   │
│   ├── gpu-utils/              # GPU monitoring
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── docker-utils/           # Docker helpers
│   │   ├── src/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── elasticsearch-manager/  # ES container management
│       ├── src/
│       │   ├── dockerManager.ts
│       │   └── index.ts
│       └── package.json
│
├── scripts/                    # Root-level scripts
│   ├── run-dev.js              # Dev environment orchestrator
│   ├── run-prod.js             # Production startup
│   ├── upgrade-db.js           # Database migration
│   ├── wipe-data.js            # Database reset
│   └── (other utility scripts)
│
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md
│   ├── COMPONENT_MAP.md
│   ├── NAVIGATION.md
│   ├── API_REFERENCE.md
│   ├── DATA_FLOWS.md
│   └── SCHEMA_REFERENCE.md
│
├── models/                     # Local model storage (gitignored)
│
├── docker-compose.yml          # Core services
├── docker-compose.gpu.yml      # GPU overrides
├── .env*                       # Environment files
├── package.json                # Root workspace config
├── turbo.json                  # Turborepo config
├── tsconfig.base.json          # Base TypeScript config
├── .prettierrc                 # Prettier config
└── vitest.config.ts            # Vitest config
```

## Key Locations

### Entry Points

| Component  | File                              | Description          |
| ---------- | --------------------------------- | -------------------- |
| API Server | `packages/api/src/server.ts`      | Main ElysiaJS server |
| Worker     | `packages/worker/src/index.ts`    | BullMQ worker entry  |
| UI         | `packages/ui/src/index.tsx`       | React app entry      |
| Whisper    | `packages/whisper/whisper_api.py` | FastAPI server       |

### Configuration

| Purpose            | Location                                         |
| ------------------ | ------------------------------------------------ |
| Environment config | `.env.api.dev`, `.env.worker.dev`                |
| Package config     | `packages/*/package.json`                        |
| TypeScript config  | `tsconfig.base.json`, `packages/*/tsconfig.json` |
| Docker config      | `docker-compose.yml`, `docker-compose.gpu.yml`   |
| Build config       | `turbo.json`, `packages/ui/webpack.config.js`    |
| Test config        | `vitest.config.ts`                               |

### Data Layer

| Purpose             | Location                           |
| ------------------- | ---------------------------------- |
| Database connection | `packages/db/src/sqliteService.ts` |
| Migrations          | `packages/db/src/`                 |
| Repositories        | `packages/data/src/repositories/`  |
| Domain schemas      | `packages/domain/src/schemas/`     |

### Services

| Purpose           | Location                                               |
| ----------------- | ------------------------------------------------------ |
| LLM management    | `packages/api/src/services/llamaCppService.ts`         |
| Transcription     | `packages/api/src/services/transcriptionService.ts`    |
| Job queue         | `packages/api/src/services/jobQueueService.ts`         |
| GPU monitoring    | `packages/api/src/services/gpuService.ts`              |
| Docker management | `packages/api/src/services/dockerManagementService.ts` |

### UI Components

| Purpose        | Location                                                      |
| -------------- | ------------------------------------------------------------- |
| Session list   | `packages/ui/src/components/LandingPage/SessionListTable.tsx` |
| Session view   | `packages/ui/src/components/SessionView/SessionView.tsx`      |
| Chat interface | `packages/ui/src/components/SessionView/SessionContent.tsx`   |
| Upload modal   | `packages/ui/src/components/UploadModal/UploadModal.tsx`      |
| Analysis jobs  | `packages/ui/src/components/Analysis/AnalysisJobsPage.tsx`    |
| GPU status     | `packages/ui/src/components/User/GpuStatusModal.tsx`          |
| Settings       | `packages/ui/src/components/SettingsPage.tsx`                 |

## Naming Conventions

### Files

- **TypeScript:** camelCase with `.ts` extension
- **React components:** PascalCase with `.tsx` extension
- **Test files:** `*.test.ts` adjacent to source
- **Config files:** kebab-case (e.g., `tsconfig.base.json`)

### Variables & Functions

- **Variables:** camelCase
- **Functions:** camelCase
- **Constants:** UPPER_SNAKE_CASE (e.g., `TRANSCRIPTION_QUEUE`)
- **Private members:** prefixed with `_` (e.g., `_insertSessionStmt`)

### Types

- **Interfaces/Types:** PascalCase
- **Schema types:** Suffix with `Request`, `Response`, or row type (e.g., `SessionRow`)
- **Zod schemas:** camelCase with schema suffix (e.g., `sessionSchema`)

### Components

- **React components:** PascalCase (e.g., `SessionView`, `UploadModal`)
- **Hooks:** camelCase with `use` prefix (e.g., `useMessageStream`)
- **Atoms:** camelCase with `Atom` suffix (e.g., `activeSessionIdAtom`)

## Module Resolution

### Internal Packages

All internal packages use `@therascript/*` namespace:

```typescript
import config from '@therascript/config';
import { db } from '@therascript/db';
import { sessionSchema } from '@therascript/domain';
```

### Path Resolution

- **TypeScript:** `moduleResolution: "NodeNext"` in tsconfig
- **Yarn Workspaces:** Symlinked `node_modules/@therascript/*`
- **Build output:** Compiled to `dist/` in each package

## Build Output

Each package compiles to its own `dist/` directory:

```
packages/
├── api/dist/           # Compiled API server
├── worker/dist/        # Compiled worker
├── ui/dist/            # Webpack bundle
├── db/dist/            # Compiled DB layer
└── ...
```

Build artifacts are gitignored (`.gitignore` in each package).

---

_Last updated: 2026-04-08 after codebase mapping_
