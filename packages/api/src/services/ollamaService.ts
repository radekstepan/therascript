import config from '../config/index.js';
import type {
  BackendChatMessage,
  OllamaModelInfo,
  OllamaPullJobStatus,
} from '../types/index.js'; // Added OllamaPullJobStatus
import type { ChatResponse, ListResponse, ProgressResponse } from 'ollama';
import type * as RealService from './ollamaService.real.js'; // Use .real suffix
import type * as MockService from './ollamaService.mock.js';

// Define a common interface that both real and mock services should implement
// This helps ensure consistency.
interface OllamaServiceInterface {
  listModels: () => Promise<OllamaModelInfo[]>;
  checkModelStatus: (
    modelToCheck: string
  ) => Promise<OllamaModelInfo | null | { status: 'unavailable' }>;
  loadOllamaModel: (modelName: string) => Promise<void>;
  unloadActiveModel: (modelToUnloadOverride?: string) => Promise<string>;
  ensureOllamaReady: (timeoutMs?: number) => Promise<void>;
  reloadActiveModelContext: () => Promise<void>;
  streamChatResponse: (
    contextTranscript: string | null,
    chatHistory: BackendChatMessage[],
    retryAttempt?: boolean
  ) => Promise<AsyncIterable<ChatResponse>>;
  startPullModelJob: (modelName: string) => string;
  getPullModelJobStatus: (jobId: string) => OllamaPullJobStatus | null;
  cancelPullModelJob: (jobId: string) => boolean;
  deleteOllamaModel: (modelName: string) => Promise<string>;
  checkOllamaApiHealth: () => Promise<boolean>;
}

let service: OllamaServiceInterface;

// Conditionally import and assign the service based on APP_MODE
if (config.server.appMode === 'mock') {
  const mockModule = await import('./ollamaService.mock.js');
  service = mockModule;
} else {
  // Assume real implementation is in a separate file
  const realModule = await import('./ollamaService.real.js');
  service = realModule;
}

// Export functions from the dynamically chosen service
export const listModels = service.listModels;
export const checkModelStatus = service.checkModelStatus;
export const loadOllamaModel = service.loadOllamaModel;
export const unloadActiveModel = service.unloadActiveModel;
export const ensureOllamaReady = service.ensureOllamaReady;
export const reloadActiveModelContext = service.reloadActiveModelContext;
export const streamChatResponse = service.streamChatResponse;
export const startPullModelJob = service.startPullModelJob;
export const getPullModelJobStatus = service.getPullModelJobStatus;
export const cancelPullModelJob = service.cancelPullModelJob;
export const deleteOllamaModel = service.deleteOllamaModel;
export const checkOllamaApiHealth = service.checkOllamaApiHealth;
