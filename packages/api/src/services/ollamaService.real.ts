// packages/api/src/services/ollamaService.real.ts
// Contains the original, real implementation of ollamaService.ts

// --- Keep original imports for ollama, axios, crypto, etc. ---
import ollama, {
  ChatResponse,
  Message,
  ListResponse,
  ShowResponse,
  GenerateResponse,
  Message as OllamaApiMessage,
  ProgressResponse,
  PullRequest,
  ModelResponse,
} from 'ollama'; // Added ModelResponse type explicit import
import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto'; // Import crypto for job ID
import config from '../config/index.js';
// --- Use imported types from central location ---
import {
  BackendChatMessage,
  OllamaModelInfo,
  OllamaPullJobStatus,
  OllamaPullJobStatusState,
} from '../types/index.js';
// --- End Import ---
import {
  InternalServerError,
  BadRequestError,
  ApiError,
  NotFoundError,
  ConflictError,
} from '../errors.js'; // Added ConflictError
import {
  getActiveModel,
  getConfiguredContextSize,
} from './activeModelService.js';
import { exec as callbackExec } from 'node:child_process';
import * as util from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs'; // For checking compose file
import { fileURLToPath } from 'node:url';
import { templateRepository } from '../repositories/templateRepository.js';
import { SYSTEM_PROMPT_TEMPLATES } from '@therascript/db/dist/sqliteService.js';

const exec = util.promisify(callbackExec);

console.log('[Real Service] Using Real Ollama Service'); // Identify real service

// --- Keep original Docker Management Logic ---
const OLLAMA_PACKAGE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../../..',
  'ollama'
);
const OLLAMA_COMPOSE_FILE = path.join(OLLAMA_PACKAGE_DIR, 'docker-compose.yml');
const OLLAMA_SERVICE_NAME = 'ollama'; // Match service name in ollama's compose file

async function runOllamaComposeCommand(command: string): Promise<string> {
  if (!fs.existsSync(OLLAMA_COMPOSE_FILE)) {
    console.error(
      `[Real Ollama Docker] Compose file not found at: ${OLLAMA_COMPOSE_FILE}`
    );
    throw new InternalServerError(
      `Ollama docker-compose.yml not found at ${OLLAMA_COMPOSE_FILE}`
    );
  }
  const composeCommand = `docker compose -f "${OLLAMA_COMPOSE_FILE}" ${command}`;
  console.log(`[Real Ollama Docker] Running: ${composeCommand}`);
  try {
    const { stdout, stderr } = await exec(composeCommand);
    if (stderr && !stderr.toLowerCase().includes('warn')) {
      console.warn(`[Real Ollama Docker] Compose stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error: any) {
    console.error(`[Real Ollama Docker] Error executing: ${composeCommand}`);
    if (error.stderr)
      console.error(`[Real Ollama Docker] Stderr: ${error.stderr}`);
    if (error.stdout)
      console.error(`[Real Ollama Docker] Stdout: ${error.stdout}`);
    throw new InternalServerError(
      `Failed to run Ollama Docker Compose command: ${command}. Error: ${error.message}`
    );
  }
}

async function isOllamaContainerRunning(): Promise<boolean> {
  try {
    const containerId = await runOllamaComposeCommand(
      `ps -q ${OLLAMA_SERVICE_NAME}`
    );
    return !!containerId;
  } catch (error: any) {
    console.warn(
      `[Real Ollama Docker] Error checking running status (likely not running): ${error.message}`
    );
    return false;
  }
}

async function isOllamaApiResponsive(): Promise<boolean> {
  try {
    await axios.get(config.ollama.baseURL, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
}

export async function ensureOllamaReady(timeoutMs = 30000): Promise<void> {
  console.log('[Real Ollama Docker] Ensuring Ollama service is ready...');
  if ((await isOllamaContainerRunning()) && (await isOllamaApiResponsive())) {
    console.log(
      '[Real Ollama Docker] ? Ollama container running and API responsive.'
    );
    return;
  }
  if (!(await isOllamaContainerRunning())) {
    console.log(
      '[Real Ollama Docker] ??? Ollama container not running. Attempting to start...'
    );
    try {
      await runOllamaComposeCommand(`up -d ${OLLAMA_SERVICE_NAME}`);
      console.log(
        "[Real Ollama Docker] 'docker compose up -d ollama' command issued."
      );
    } catch (startError: any) {
      console.error(
        '[Real Ollama Docker] ? Failed to issue start command for Ollama service:',
        startError
      );
      throw new InternalServerError(
        'Failed to start Ollama Docker service.',
        startError
      );
    }
  } else {
    console.log(
      '[Real Ollama Docker] Container process found, but API was not responsive. Waiting...'
    );
  }
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    console.log(
      '[Real Ollama Docker] ? Waiting for Ollama API to become responsive...'
    );
    if (await isOllamaApiResponsive()) {
      console.log('[Real Ollama Docker] ? Ollama API is now responsive.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.error(
    `[Real Ollama Docker] ? Ollama API did not become responsive within ${timeoutMs / 1000} seconds.`
  );
  throw new InternalServerError(
    `Ollama service started but API did not respond within timeout.`
  );
}

// --- ADDED ---
/**
 * Checks if the Ollama API is reachable and responsive.
 * @returns {Promise<boolean>} True if the service is healthy, false otherwise.
 */
export const checkOllamaApiHealth = async (): Promise<boolean> => {
  return isOllamaApiResponsive();
};
// --- END ADDED ---

// Helper to get system prompts from DB with fallback
const getSystemPrompt = (
  title: 'system_prompt' | 'system_standalone_prompt'
): string => {
  const template = templateRepository.findByTitle(title);
  if (template) {
    return template.text;
  }
  console.warn(
    `[OllamaService] System template "${title}" not found in DB. Using hardcoded fallback.`
  );
  if (title === 'system_prompt') {
    return SYSTEM_PROMPT_TEMPLATES.SESSION_CHAT.text;
  }
  // 'system_standalone_prompt'
  return SYSTEM_PROMPT_TEMPLATES.STANDALONE_CHAT.text;
};

// --- Keep original Pull Job Status store ---
// Make sure the type annotation uses the imported type
const activePullJobs = new Map<string, OllamaPullJobStatus>();
const pullJobCancellationFlags = new Map<string, boolean>();

// --- NEW: Helper to fetch model details and parse context size ---
async function _fetchModelDefaultContextSize(
  modelName: string
): Promise<number | null> {
  try {
    console.log(
      `[Real OllamaService] Fetching details for ${modelName} to get context size...`
    );
    const showResponse: ShowResponse = await ollama.show({ model: modelName });
    if (showResponse.parameters) {
      const parametersString = showResponse.parameters;
      const lines = parametersString.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/); // Split by one or more spaces
        if (parts[0].toLowerCase() === 'num_ctx' && parts.length > 1) {
          const numCtx = parseInt(parts[1], 10);
          if (!isNaN(numCtx) && numCtx > 0) {
            console.log(
              `[Real OllamaService] Parsed num_ctx ${numCtx} for ${modelName}`
            );
            return numCtx;
          }
        }
      }
    }
    console.warn(
      `[Real OllamaService] Could not parse num_ctx from parameters for ${modelName}. Modelfile params string: ${showResponse.parameters}`
    );
    return null;
  } catch (error: any) {
    console.error(
      `[Real OllamaService] Error fetching/parsing details for ${modelName} for context size:`,
      error.message || error
    );
    return null; // Return null if 'ollama show' fails or parsing fails
  }
}
// --- END NEW HELPER ---

// --- MODIFIED: listModels to include defaultContextSize ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
  console.log(`[Real OllamaService] Request to list available models...`);
  try {
    await ensureOllamaReady();
    console.log(
      `[Real OllamaService] Ollama ready. Fetching models from ${config.ollama.baseURL}/api/tags`
    );
    const response: ListResponse = await ollama.list();

    const modelsWithDetails: OllamaModelInfo[] = await Promise.all(
      response.models.map(
        async (model: ModelResponse): Promise<OllamaModelInfo> => {
          const modifiedAtDate =
            typeof model.modified_at === 'string'
              ? new Date(model.modified_at)
              : (model.modified_at ?? new Date(0));
          const expiresAtDate =
            typeof model.expires_at === 'string'
              ? new Date(model.expires_at)
              : (model.expires_at ?? undefined);

          // Fetch default context size for each model
          const defaultCtxSize = await _fetchModelDefaultContextSize(
            model.name
          );

          return {
            name: model.name,
            modified_at: modifiedAtDate,
            size: model.size,
            digest: model.digest,
            details: {
              format: model.details.format,
              family: model.details.family,
              families: model.details.families,
              parameter_size: model.details.parameter_size,
              quantization_level: model.details.quantization_level,
            },
            defaultContextSize: defaultCtxSize,
            size_vram: model.size_vram,
            expires_at: expiresAtDate,
          };
        }
      )
    );
    return modelsWithDetails;
  } catch (error: any) {
    console.error(
      '[Real OllamaService] Error fetching available models:',
      error
    );
    if (error.message?.includes('ECONNREFUSED')) {
      throw new InternalServerError(
        `Connection refused after readiness check: Could not connect to Ollama at ${config.ollama.baseURL} to list models.`
      );
    }
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to list models from Ollama service after readiness check.',
      error instanceof Error ? error : new Error(String(error))
    );
  }
};
// --- END MODIFIED listModels ---

// --- Keep original Parse Ollama Pull Stream Chunk ---
function parseOllamaPullStreamChunk(
  chunk: ProgressResponse
): Partial<OllamaPullJobStatus> {
  let percentage: number | undefined = undefined;
  if (chunk.total && chunk.completed) {
    percentage = Math.round((chunk.completed / chunk.total) * 100);
  }
  let internalStatus: OllamaPullJobStatusState = 'downloading'; // Use imported state type
  const message = chunk.status;
  if (message.includes('pulling manifest')) internalStatus = 'parsing';
  else if (message.includes('verifying sha256 digest'))
    internalStatus = 'verifying';
  else if (message.includes('writing manifest')) internalStatus = 'verifying';
  else if (message.includes('removing any unused layers'))
    internalStatus = 'verifying';
  else if (message.toLowerCase().includes('success'))
    internalStatus = 'completed';
  else if (message.toLowerCase().includes('error')) internalStatus = 'failed';
  const currentLayer = chunk.digest ? chunk.digest.substring(7, 19) : undefined;
  return {
    status: internalStatus,
    message: message,
    progress: percentage,
    completedBytes: chunk.completed,
    totalBytes: chunk.total,
    currentLayer: currentLayer,
    ...(internalStatus === 'failed' && { error: message }),
  };
}

// --- Keep original Background Pull Task Runner ---
async function runPullInBackground(jobId: string, modelName: string) {
  console.log(
    `[Real OllamaBG ${jobId}] Starting background pull for ${modelName}`
  );
  const jobStartTime = Date.now();
  // Ensure the job status type is correct here
  activePullJobs.set(jobId, {
    jobId,
    modelName,
    status: 'queued',
    message: 'Pull queued',
    startTime: jobStartTime,
  });
  pullJobCancellationFlags.set(jobId, false);
  try {
    await ensureOllamaReady();
    const stream = await ollama.pull({ model: modelName, stream: true });
    activePullJobs.set(jobId, {
      ...activePullJobs.get(jobId)!,
      status: 'parsing',
      message: 'Pulling manifest...',
    });
    for await (const chunk of stream) {
      if (pullJobCancellationFlags.get(jobId)) {
        console.log(
          `[Real OllamaBG ${jobId}] Cancellation requested, stopping pull for ${modelName}.`
        );
        activePullJobs.set(jobId, {
          ...activePullJobs.get(jobId)!,
          status: 'canceled',
          message: 'Pull canceled by user.',
          endTime: Date.now(),
        });
        return;
      }
      const progressUpdate = parseOllamaPullStreamChunk(chunk);
      const currentStatus = activePullJobs.get(jobId);
      if (currentStatus && !pullJobCancellationFlags.get(jobId)) {
        // Ensure status update uses correct type
        activePullJobs.set(jobId, {
          ...currentStatus,
          ...progressUpdate,
          status: progressUpdate.status || currentStatus.status,
          message: progressUpdate.message || currentStatus.message,
          progress: progressUpdate.progress ?? currentStatus.progress,
          error: progressUpdate.error ?? currentStatus.error,
        });
      } else if (!currentStatus) {
        console.warn(
          `[Real OllamaBG ${jobId}] Job status not found during update for ${modelName}. Stopping task.`
        );
        return;
      }
      if (
        progressUpdate.status === 'completed' ||
        progressUpdate.status === 'failed'
      ) {
        console.log(
          `[Real OllamaBG ${jobId}] Terminal status '${progressUpdate.status}' detected from chunk for ${modelName}.`
        );
        activePullJobs.set(jobId, {
          ...activePullJobs.get(jobId)!,
          endTime: Date.now(),
        });
        break;
      }
    }
    const finalStatus = activePullJobs.get(jobId);
    if (
      finalStatus &&
      finalStatus.status !== 'failed' &&
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'canceled' &&
      finalStatus.status !== 'canceling'
    ) {
      console.log(
        `[Real OllamaBG ${jobId}] Stream ended normally, marking job as completed for ${modelName}.`
      );
      activePullJobs.set(jobId, {
        ...finalStatus,
        status: 'completed',
        message: 'Pull finished successfully.',
        progress: 100,
        endTime: Date.now(),
      });
    } else if (finalStatus) {
      console.log(
        `[Real OllamaBG ${jobId}] Stream ended, job already had terminal status: ${finalStatus.status}`
      );
      if (!finalStatus.endTime) {
        activePullJobs.set(jobId, { ...finalStatus, endTime: Date.now() });
      }
    }
  } catch (error: any) {
    console.error(
      `[Real OllamaBG ${jobId}] Error during background pull for ${modelName}:`,
      error
    );
    const finalStatus = activePullJobs.get(jobId);
    // Ensure status update uses correct type
    activePullJobs.set(jobId, {
      ...(finalStatus ?? {
        jobId,
        modelName,
        status: 'failed' as OllamaPullJobStatusState,
        message: 'Pull failed',
        startTime: jobStartTime,
      }),
      status: 'failed',
      error: error.message || 'Unknown error during pull',
      message: `Pull failed: ${error.message || 'Unknown'}`,
      endTime: Date.now(),
    });
  } finally {
    pullJobCancellationFlags.delete(jobId);
    console.log(
      `[Real OllamaBG ${jobId}] Background pull task finished for ${modelName}. Final status: ${activePullJobs.get(jobId)?.status}`
    );
  }
}

// --- Keep original Start Pull Model Job ---
export const startPullModelJob = (modelName: string): string => {
  if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
    throw new BadRequestError('Invalid model name provided.');
  }
  const jobId = crypto.randomUUID();
  console.log(
    `[Real OllamaService] Queuing pull job ${jobId} for model: ${modelName}`
  );
  void runPullInBackground(jobId, modelName).catch((err) => {
    console.error(
      `[Real OllamaService] CRITICAL: Uncaught error escaped background pull job ${jobId} for ${modelName}:`,
      err
    );
    const currentStatus = activePullJobs.get(jobId);
    if (
      currentStatus &&
      currentStatus.status !== 'completed' &&
      currentStatus.status !== 'failed' &&
      currentStatus.status !== 'canceled'
    ) {
      activePullJobs.set(jobId, {
        ...currentStatus,
        status: 'failed',
        error: 'Background task crashed unexpectedly',
        message: 'Background task crashed',
        endTime: Date.now(),
      });
    }
  });
  return jobId;
};

// --- Keep original Get Pull Model Job Status ---
// Ensure return type uses the imported type
export const getPullModelJobStatus = (
  jobId: string
): OllamaPullJobStatus | null => {
  const status = activePullJobs.get(jobId);
  if (config.server.isProduction) {
    console.log(
      `[Real OllamaService] Getting status for job ${jobId}. Found: ${!!status}`
    );
  } else {
    console.log(
      `[Real OllamaService] Getting status for job ${jobId}. Status:`,
      status
    );
  }
  return status ? { ...status } : null; // Return copy or null
};

// --- Keep original Cancel Pull Model Job ---
export const cancelPullModelJob = (jobId: string): boolean => {
  const job = activePullJobs.get(jobId);
  if (!job) {
    console.log(
      `[Real OllamaService] Cancel request for non-existent job ${jobId}`
    );
    return false;
  }
  if (
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'canceled' ||
    job.status === 'canceling'
  ) {
    console.log(
      `[Real OllamaService] Job ${jobId} is already in state (${job.status}), cannot cancel.`
    );
    return false;
  }
  console.log(
    `[Real OllamaService] Setting cancellation flag for job ${jobId}`
  );
  pullJobCancellationFlags.set(jobId, true);
  // Ensure status update uses correct type
  activePullJobs.set(jobId, {
    ...job,
    status: 'canceling',
    message: 'Cancellation requested...',
  });
  return true;
};

// --- Keep original Delete Ollama Model Service Function ---
export const deleteOllamaModel = async (modelName: string): Promise<string> => {
  if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
    throw new BadRequestError('Invalid model name provided for deletion.');
  }
  console.log(`[Real OllamaService] Request to delete model '${modelName}'...`);

  // 1. Ensure Ollama service is running
  try {
    await ensureOllamaReady();
  } catch (error) {
    throw error;
  }

  // 2. Check if the model is currently loaded
  const loadedStatus = await checkModelStatus(modelName);
  if (
    loadedStatus &&
    typeof loadedStatus === 'object' &&
    'name' in loadedStatus
  ) {
    console.warn(
      `[Real OllamaService] Attempting to delete model '${modelName}' which appears to be currently loaded.`
    );
    // --- FIX: Unload before deleting ---
    console.log(
      `[Real OllamaService] Attempting to unload model '${modelName}' before deletion...`
    );
    try {
      await unloadActiveModel(modelName); // Attempt to unload it first
    } catch (unloadError) {
      console.warn(
        `[Real OllamaService] Failed to explicitly unload model '${modelName}' before delete (will proceed anyway):`,
        unloadError
      );
    }
    // --- END FIX ---
  } else if (loadedStatus === null) {
    console.log(
      `[Real OllamaService] Model '${modelName}' confirmed not loaded.`
    );
  } else if (loadedStatus?.status === 'unavailable') {
    throw new InternalServerError(
      'Ollama service became unavailable after readiness check.'
    );
  }

  // 3. Execute the delete command
  try {
    console.log(
      `[Real OllamaService] Executing delete command for '${modelName}'...`
    );
    const deleteOutput = await runOllamaComposeCommand(
      `exec -T ${OLLAMA_SERVICE_NAME} ollama rm ${modelName}`
    );
    console.log(
      `[Real OllamaService] Delete command output for '${modelName}':`,
      deleteOutput
    );
    if (
      deleteOutput.toLowerCase().includes('deleted') ||
      deleteOutput.toLowerCase().includes('removed')
    ) {
      return `Model '${modelName}' deleted successfully.`;
    } else if (deleteOutput.toLowerCase().includes('not found')) {
      console.warn(
        `[Real OllamaService] Model '${modelName}' not found during delete attempt.`
      );
      throw new NotFoundError(`Model '${modelName}' not found locally.`);
    } else {
      console.error(
        `[Real OllamaService] Unknown response from 'ollama rm ${modelName}': ${deleteOutput}`
      );
      throw new InternalServerError(
        `Failed to delete model '${modelName}'. Output: ${deleteOutput}`
      );
    }
  } catch (error: any) {
    console.error(
      `[Real OllamaService] Error executing delete command for '${modelName}':`,
      error
    );
    if (error.message?.toLowerCase().includes('not found')) {
      throw new NotFoundError(`Model '${modelName}' not found locally.`);
    }
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      `Failed to execute delete command for model '${modelName}'.`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

// --- MODIFIED: checkModelStatus to include defaultContextSize ---
export const checkModelStatus = async (
  modelToCheck: string
): Promise<OllamaModelInfo | null | { status: 'unavailable' }> => {
  console.log(
    `[Real OllamaService] Checking if specific model '${modelToCheck}' is loaded...`
  );
  try {
    await ensureOllamaReady();
    const response = await ollama.ps();
    const loadedModelEntry = response.models.find(
      (model: any) => model.name === modelToCheck
    );

    if (loadedModelEntry) {
      console.log(
        `[Real OllamaService] Specific model '${modelToCheck}' found loaded.`
      );
      const modifiedAtDate = loadedModelEntry.modified_at
        ? new Date(loadedModelEntry.modified_at)
        : new Date(0);
      const expiresAtDate = loadedModelEntry.expires_at
        ? new Date(loadedModelEntry.expires_at)
        : undefined;

      // Fetch default context size for the loaded model
      const defaultCtxSize = await _fetchModelDefaultContextSize(modelToCheck);

      return {
        name: loadedModelEntry.name,
        modified_at: modifiedAtDate,
        size: loadedModelEntry.size ?? 0,
        digest: loadedModelEntry.digest,
        details: loadedModelEntry.details ?? {
          format: 'unknown',
          family: 'unknown',
          families: null,
          parameter_size: 'unknown',
          quantization_level: 'unknown',
        },
        defaultContextSize: defaultCtxSize, // <-- ADDED
        size_vram: loadedModelEntry.size_vram,
        expires_at: expiresAtDate,
      };
    } else {
      console.log(
        `[Real OllamaService] Specific model '${modelToCheck}' not found among loaded models:`,
        response.models.map((m: any) => m.name)
      );
      return null;
    }
  } catch (error: any) {
    console.warn(
      `[Real OllamaService] Error checking status for specific model '${modelToCheck}':`,
      error.message
    );
    if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
      console.warn(
        `[Real OllamaService] Connection refused. Ollama service appears to be unavailable.`
      );
      return { status: 'unavailable' };
    }
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.warn(
        `[Real OllamaService] Connection refused (ollama lib). Ollama service appears to be unavailable.`
      );
      return { status: 'unavailable' };
    }
    console.log(
      `[Real OllamaService] Assuming specific model '${modelToCheck}' is not loaded due to other error.`
    );
    return null;
  }
};
// --- END MODIFIED checkModelStatus ---

// --- Keep original Load Model Function ---
export const loadOllamaModel = async (modelName: string): Promise<void> => {
  if (!modelName) {
    throw new BadRequestError('Model name must be provided to load.');
  }
  console.log(`[Real OllamaService] Request to load model '${modelName}'...`);
  try {
    await ensureOllamaReady();
    console.log(
      `[Real OllamaService] Ollama service is ready. Proceeding with load trigger for '${modelName}'.`
    );
  } catch (error) {
    throw error;
  }
  console.log(
    `[Real OllamaService] Triggering load for model '${modelName}' using a minimal chat request...`
  );
  try {
    const response = await ollama.chat({
      model: modelName,
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
      keep_alive: config.ollama.keepAlive, // Use configured keep_alive
    });
    console.log(
      `[Real OllamaService] Minimal chat request completed for '${modelName}'. Status: ${response.done}. Ollama should now be loading/have loaded it.`
    );
  } catch (error: any) {
    console.error(
      `[Real OllamaService] Error during load trigger chat request for '${modelName}':`,
      error
    );
    const isModelNotFoundError =
      error.status === 404 ||
      (error.message?.includes('model') &&
        (error.message?.includes('not found') ||
          error.message?.includes('missing')));
    if (isModelNotFoundError) {
      console.error(
        `[Real OllamaService] Model '${modelName}' not found locally during load attempt. It needs to be pulled first.`
      );
      throw new BadRequestError(
        `Model '${modelName}' not found locally. Please pull the model first.`
      );
    }
    if (error.message?.includes('ECONNREFUSED')) {
      throw new InternalServerError(
        `Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`
      );
    }
    throw new InternalServerError(
      `Failed to trigger load for model '${modelName}' via chat request.`,
      error instanceof Error ? error : undefined
    );
  }
};

// --- NEW: Real Unload Function ---
/**
 * Sends a request to Ollama to unload the specified model (or the currently active one if none specified).
 * @param modelToUnload Optional specific model name to unload. Defaults to the active model.
 * @returns A promise resolving to a success message.
 * @throws {ApiError} If the unload request fails.
 */
export const unloadActiveModel = async (
  modelToUnloadOverride?: string
): Promise<string> => {
  const modelToUnload = modelToUnloadOverride || getActiveModel();
  console.log(
    `[Real OllamaService:unload] Sending unload request (keep_alive: 0) for model ${modelToUnload}...`
  );

  try {
    await ensureOllamaReady(); // Ensure service is reachable
    await ollama.chat({
      model: modelToUnload,
      messages: [{ role: 'user', content: 'unload request' }],
      keep_alive: 0, // Explicitly unload
      stream: false,
    });
    console.log(
      `[Real OllamaService:unload] Unload request sent successfully for ${modelToUnload}.`
    );
    return `Unload request sent for model ${modelToUnload}. It will be unloaded shortly if idle.`;
  } catch (error: any) {
    console.error(
      `[Real OllamaService:unload] Error sending unload request for ${modelToUnload}:`,
      error
    );
    // Specific error handling
    const isModelNotFoundError =
      error.status === 404 ||
      (error.message?.includes('model') &&
        (error.message?.includes('not found') ||
          error.message?.includes('missing')));
    if (isModelNotFoundError) {
      console.log(
        `[Real OllamaService:unload] Model ${modelToUnload} not found by Ollama (likely already unloaded).`
      );
      // Consider this a success from the user's perspective
      return `Model ${modelToUnload} was not found (likely already unloaded).`;
    }
    const isConnectionError =
      (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
      error.message?.includes('ECONNREFUSED');
    if (isConnectionError) {
      console.warn(
        `[Real OllamaService:unload] Connection refused when trying to unload ${modelToUnload}. Assuming stopped/unloaded.`
      );
      // Treat as success? Or maybe a 503? Let's go with success for now.
      return `Could not connect to Ollama to explicitly unload ${modelToUnload}. It might already be stopped or unloaded.`;
    }
    // Default to InternalServerError for other errors
    throw new InternalServerError(
      `Failed to send unload request to Ollama service for model ${modelToUnload}.`,
      error instanceof Error ? error : undefined
    );
  }
};
// --- END NEW ---

// --- Keep original Reload Active Model Context Function ---
export const reloadActiveModelContext = async (): Promise<void> => {
  const modelName = getActiveModel();
  if (!modelName) {
    console.warn(
      '[Real OllamaService:reload] No active model set. Skipping reload.'
    );
    return;
  }
  console.log(
    `[Real OllamaService:reload] Attempting to reload context for active model: ${modelName}`
  );
  try {
    await ensureOllamaReady();
  } catch (error) {
    console.error(
      `[Real OllamaService:reload] Ollama not ready, cannot reload model ${modelName}:`,
      error
    );
    throw error; // Propagate readiness error
  }

  // 1. Attempt Unload (keep_alive: 0) - Use the new unload function
  try {
    await unloadActiveModel(modelName); // Call the specific unload function
  } catch (unloadError: any) {
    // Check if the error message indicates it was already unloaded
    if (
      unloadError instanceof ApiError &&
      unloadError.message.includes('already unloaded')
    ) {
      console.log(
        `[Real OllamaService:reload] Model ${modelName} reported as already unloaded. Proceeding to load.`
      );
    } else if (
      unloadError instanceof InternalServerError &&
      unloadError.message.includes('Connection refused')
    ) {
      console.error(
        `[Real OllamaService:reload] Connection refused during unload for ${modelName}.`
      );
      throw unloadError; // Re-throw connection error
    } else {
      console.warn(
        `[Real OllamaService:reload] Error during unload request for ${modelName} (will still attempt load):`,
        unloadError
      );
      // Don't throw other unload errors, proceed to load attempt
    }
  }

  // 2. Trigger Load (keep_alive: configured duration)
  try {
    console.log(
      `[Real OllamaService:reload] Sending load request (keep_alive: ${config.ollama.keepAlive}) for ${modelName}...`
    );
    await ollama.chat({
      model: modelName,
      messages: [{ role: 'user', content: 'load' }], // Minimal message
      stream: false,
      keep_alive: config.ollama.keepAlive, // Use configured duration
    });
    console.log(
      `[Real OllamaService:reload] Load request sent successfully for ${modelName}.`
    );
  } catch (loadError: any) {
    console.error(
      `[Real OllamaService:reload] Error during load request for ${modelName}:`,
      loadError
    );
    const isModelNotFoundError =
      loadError.status === 404 ||
      (loadError.message?.includes('model') &&
        (loadError.message?.includes('not found') ||
          loadError.message?.includes('missing')));
    if (isModelNotFoundError) {
      console.error(
        `[Real OllamaService:reload] Model '${modelName}' not found locally during load attempt.`
      );
      throw new BadRequestError(
        `Model '${modelName}' not found locally. Cannot reload.`
      );
    }
    if (loadError.message?.includes('ECONNREFUSED')) {
      throw new InternalServerError(
        `Connection refused during load attempt for ${modelName}.`
      );
    }
    throw new InternalServerError(
      `Failed to trigger reload for model '${modelName}' via chat request.`,
      loadError instanceof Error ? loadError : undefined
    );
  }
  console.log(
    `[Real OllamaService:reload] Context reload sequence completed for ${modelName}.`
  );
};

// --- MODIFIED: Stream Chat Response to accept options and handle system prompts ---
export const streamChatResponse = async (
  contextTranscript: string | null,
  chatHistory: BackendChatMessage[],
  options?: { model?: string; contextSize?: number }
): Promise<AsyncIterable<ChatResponse>> => {
  const modelToUse = options?.model || getActiveModel();
  const contextSize =
    options?.contextSize !== undefined
      ? options.contextSize
      : getConfiguredContextSize();

  const isStandalone = contextTranscript === null;
  console.log(
    `[Real OllamaService:streamChatResponse] Attempting stream with MODEL: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`
  );

  try {
    await ensureOllamaReady();
  } catch (error) {
    throw error;
  }

  if (!chatHistory || chatHistory.length === 0)
    throw new InternalServerError(
      'Internal Error: Cannot stream response without chat history.'
    );

  // --- MODIFICATION START ---
  const hasSystemPrompt = chatHistory.some((msg) => msg.sender === 'system');
  const messages: OllamaApiMessage[] = [];

  const mapSenderToRole = (
    sender: 'user' | 'ai' | 'system'
  ): 'user' | 'assistant' | 'system' => {
    if (sender === 'ai') return 'assistant';
    return sender;
  };

  if (hasSystemPrompt) {
    // New behavior for analysis jobs: Trust the provided message array completely
    chatHistory.forEach((msg) => {
      messages.push({
        role: mapSenderToRole(msg.sender),
        content: msg.text,
      });
    });
  } else {
    // Original behavior for interactive chat
    if (chatHistory[chatHistory.length - 1].sender !== 'user') {
      throw new InternalServerError(
        'Internal Error: Malformed chat history for LLM.'
      );
    }
    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);

    const systemPromptContent = isStandalone
      ? getSystemPrompt('system_standalone_prompt')
      : getSystemPrompt('system_prompt');

    messages.push({
      role: 'system',
      content: systemPromptContent,
    });

    messages.push(
      ...previousHistory.map(
        (msg): OllamaApiMessage => ({
          role: mapSenderToRole(msg.sender),
          content: msg.text,
        })
      )
    );

    if (!isStandalone) {
      const transcriptContextMessage: OllamaApiMessage = {
        role: 'user',
        content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""`,
      };
      messages.push(transcriptContextMessage);
    }

    messages.push({ role: 'user', content: latestUserMessage.text });
  }
  // --- MODIFICATION END ---

  console.log(
    `[Real OllamaService] Streaming response (model: ${modelToUse})...`
  );

  try {
    // ============================= FIX START ==============================
    // Expand the list of stop tokens to prevent the model from generating them.
    const ollamaOptions: any = {
      stop: [
        '<end_of_turn>',
        '<start_of_turn>',
        '<|eot_id|>',
        '<|start_header_id|>',
        '<|end_header_id|>',
        '<|eom_id|>',
      ],
    };
    // ============================== FIX END ===============================
    if (contextSize !== null && contextSize !== undefined) {
      ollamaOptions.num_ctx = contextSize;
    }

    const stream = await ollama.chat({
      model: modelToUse,
      messages: messages,
      stream: true,
      keep_alive: config.ollama.keepAlive,
      options: ollamaOptions,
    });
    console.log(
      `[Real OllamaService] Stream initiated for model ${modelToUse}.`
    );
    return stream;
  } catch (error: any) {
    console.error('[Real OllamaService] Error initiating chat stream:', error);
    const isModelNotFoundError =
      error.status === 404 ||
      (error.message?.includes('model') &&
        (error.message?.includes('not found') ||
          error.message?.includes('missing')));
    if (isModelNotFoundError) {
      console.error(
        `[Real OllamaService] Model '${modelToUse}' not found during stream init.`
      );
      throw new BadRequestError(
        `Model '${modelToUse}' not found. Please pull or select an available model.`
      );
    }
    if (error instanceof Error) {
      const connectionError =
        (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
        (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');
      if (connectionError) {
        throw new InternalServerError(
          `Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`
        );
      }
    }
    throw new InternalServerError(
      'Failed to initiate stream from AI service.',
      error instanceof Error ? error : undefined
    );
  }
};
