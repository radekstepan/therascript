import axios from 'axios';
import {
  exec as callbackExec,
  execFile as callbackExecFile,
  spawn,
  ChildProcess,
} from 'node:child_process';
import * as util from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import config from '@therascript/config';
import { InternalServerError, NotFoundError } from '../errors.js';

const execAsync = util.promisify(callbackExec);
const execFileAsync = util.promisify(callbackExecFile);

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isWSL = (): boolean => {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    const release = os.release().toLowerCase();
    return release.includes('microsoft');
  } catch (error) {
    return false;
  }
};

type StartAttemptOutcome = {
  executed: boolean;
  success: boolean;
  message?: string;
};

export type LlmRuntimeType = 'docker' | 'native';

export interface LlmRuntime {
  readonly type: LlmRuntimeType;
  ensureReady(timeoutMs?: number): Promise<void>;
  deleteModel(modelPath: string): Promise<string>;
  restartWithModel(modelPath: string): Promise<void>;
  stop?(): Promise<void>;
}

let cachedRuntime: LlmRuntime | null = null;

export const getLlmRuntime = (): LlmRuntime => {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  // On macOS, default to native but allow fallback to docker if native binary is missing
  if (config.llm.runtime === 'native') {
    try {
      cachedRuntime = new NativeLlmRuntime();
    } catch (e) {
      console.warn(
        `[LlmRuntime] Native runtime selected but llama-server binary missing. Falling back to docker.`
      );
      cachedRuntime = new DockerLlmRuntime();
    }
  } else {
    cachedRuntime = new DockerLlmRuntime();
  }
  return cachedRuntime as LlmRuntime;
};

class DockerLlmRuntime implements LlmRuntime {
  readonly type: LlmRuntimeType = 'docker';

  private readonly composeFilePath: string;
  private readonly serviceName = 'llama-server';
  private readonly containerName = 'therascript_llama_server';
  private readonly composeDir: string;

  constructor() {
    const packageDir = path.resolve(
      fileURLToPath(import.meta.url),
      '../../../..',
      'llama'
    );
    this.composeFilePath = path.join(packageDir, 'docker-compose.yml');
    this.composeDir = path.dirname(this.composeFilePath);
  }

  private ensureComposeFileExists(): void {
    if (!fs.existsSync(this.composeFilePath)) {
      throw new InternalServerError(
        `LLM docker-compose.yml not found at ${this.composeFilePath}`
      );
    }
  }

  private resolveComposeCommand(command: string): string {
    const extraCompose = process.env.DOCKER_COMPOSE_EXTRA;
    const packageGpuOverride = path.join(
      this.composeDir,
      'docker-compose.gpu.yml'
    );

    let chosenExtra: string | null = null;

    if (extraCompose && fs.existsSync(extraCompose)) {
      if (path.dirname(extraCompose) === this.composeDir) {
        chosenExtra = extraCompose;
      } else {
        console.log(
          `[LlmRuntime:docker] Ignoring DOCKER_COMPOSE_EXTRA ${extraCompose} because it is not in ${this.composeDir}.`
        );
      }
    } else {
      const onLinux = process.platform === 'linux' || isWSL();
      if (onLinux && !process.env.LLM_DISABLE_GPU) {
        if (fs.existsSync(packageGpuOverride)) {
          chosenExtra = packageGpuOverride;
        }
      }
    }

    const extraFlag = chosenExtra ? ` -f "${chosenExtra}"` : '';
    return `docker compose -f "${this.composeFilePath}"${extraFlag} ${command}`;
  }

  private async runCompose(
    command: string,
    env?: Record<string, string>
  ): Promise<string> {
    this.ensureComposeFileExists();
    const composeCommand = this.resolveComposeCommand(command);
    console.log(`[LlmRuntime:docker] Running: ${composeCommand}`);
    try {
      const { stdout, stderr } = await execAsync(composeCommand, {
        env: { ...process.env, ...env },
      });
      if (stderr && !stderr.toLowerCase().includes('warn')) {
        console.warn(`[LlmRuntime:docker] stderr: ${stderr}`);
      }
      return stdout.trim();
    } catch (error: any) {
      console.error(
        `[LlmRuntime:docker] Command failed: ${composeCommand}`,
        error.stderr || error.message
      );
      throw new InternalServerError(
        `Failed to run Docker compose command '${command}': ${error.message}`
      );
    }
  }

  private async isContainerRunning(): Promise<boolean> {
    try {
      const containerId = await this.runCompose(`ps -q ${this.serviceName}`);
      return containerId.trim().length > 0;
    } catch (error) {
      console.warn(
        '[LlmRuntime:docker] Failed to determine container status. Assuming not running.'
      );
      return false;
    }
  }

  private async isApiResponsive(): Promise<boolean> {
    try {
      await axios.get(`${config.llm.baseURL}/health`, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  async ensureReady(timeoutMs = 30000): Promise<void> {
    console.log('[LlmRuntime:docker] Ensuring service availability...');

    const containerRunning = await this.isContainerRunning();
    if (containerRunning && (await this.isApiResponsive())) {
      console.log(
        '[LlmRuntime:docker] Container is running and API is responsive.'
      );
      return;
    }

    if (!containerRunning) {
      console.log(
        '[LlmRuntime:docker] Container not running. Attempting to start...'
      );
      try {
        await this.runCompose(`up -d ${this.serviceName}`);
      } catch (error: any) {
        throw new InternalServerError(
          'Failed to start LLM Docker service.',
          error instanceof Error ? error : undefined
        );
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.isApiResponsive()) {
        console.log('[LlmRuntime:docker] API is now responsive.');
        return;
      }
      console.log('[LlmRuntime:docker] Waiting for API to respond...');
      await delay(3000);
    }

    throw new InternalServerError(
      `LLM Docker service did not become responsive within ${timeoutMs}ms.`
    );
  }

  async deleteModel(modelPath: string): Promise<string> {
    if (!modelPath || !modelPath.trim()) {
      throw new InternalServerError('Model path required for deletion.');
    }
    const fullPath = path.resolve(config.llm.modelsDir, modelPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return `Deleted ${modelPath}`;
    }
    throw new NotFoundError(`Model file ${modelPath} not found`);
  }

  async restartWithModel(modelPath: string): Promise<void> {
    console.log(
      `[LlmRuntime:docker] Restarting server with model ${modelPath}`
    );
    try {
      await this.runCompose(`down ${this.serviceName}`);
      // Pass model path via environment variable to docker-compose
      // The path should be relative to the container (/models/)
      const containerModelPath = `/models/${path.basename(modelPath)}`;
      await this.runCompose(`up -d ${this.serviceName}`, {
        LLAMA_MODEL_PATH: containerModelPath,
      });
      await this.ensureReady(60000);
    } catch (err: any) {
      throw new InternalServerError(
        `Failed to restart docker with new model: ${err.message}`
      );
    }
  }

  async stop(): Promise<void> {
    try {
      await this.runCompose(`stop ${this.serviceName}`);
    } catch (err: any) {
      console.warn(
        `[LlmRuntime:docker] Failed to stop service: ${err.message}`
      );
    }
  }
}

class NativeLlmRuntime implements LlmRuntime {
  readonly type: LlmRuntimeType = 'native';

  private resolvedBinary: string | null = null;
  private serveProcess: ChildProcess | null = null;

  constructor() {
    this.resolveBinarySync();
  }

  private resolveBinarySync(): string {
    if (this.resolvedBinary) {
      return this.resolvedBinary;
    }

    const candidates: Array<string | null | undefined> = [
      process.env.LLAMA_SERVER_BINARY_PATH,
      // Check common paths directly to avoid async locateCommand in constructor
      '/usr/local/bin/llama-server',
      '/opt/homebrew/bin/llama-server',
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        this.resolvedBinary = candidate;
        return candidate;
      }
    }

    throw new Error('llama-server binary not found.');
  }

  private async locateCommand(command: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('which', [command]);
      const resolved = stdout.trim();
      return resolved ? resolved : null;
    } catch {
      return null;
    }
  }

  private async resolveBinary(): Promise<string> {
    return this.resolveBinarySync();
  }

  private async isApiResponsive(): Promise<boolean> {
    try {
      await axios.get(`${config.llm.baseURL}/health`, { timeout: 2500 });
      return true;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    if (timeoutMs <= 0) {
      return this.isApiResponsive();
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.isApiResponsive()) {
        return true;
      }
      await delay(2500);
    }
    return false;
  }

  private formatErrorOutput(error: any): string {
    if (error.stderr) {
      return String(error.stderr).trim();
    }
    if (error.stdout) {
      return String(error.stdout).trim();
    }
    if (error.message) {
      return error.message;
    }
    return 'Unknown error';
  }

  private async attemptStartViaServe(
    modelPath: string
  ): Promise<StartAttemptOutcome> {
    if (this.serveProcess && !this.serveProcess.killed) {
      return {
        executed: true,
        success: true,
        message: 'serve process already running',
      };
    }

    const binary = await this.resolveBinary();
    const port = new URL(config.llm.baseURL).port || '8080';

    // Resolve absolute path to models
    const resolvedModelPath = path.resolve(
      config.llm.modelsDir,
      path.basename(modelPath)
    );

    const {
      getConfiguredThinkingBudget,
      getConfiguredNumGpuLayers,
      getConfiguredContextSize,
    } = await import('./activeModelService.js');
    const thinkingBudget = getConfiguredThinkingBudget();
    const numGpuLayers = getConfiguredNumGpuLayers();
    const contextSize = getConfiguredContextSize();

    const spawnArgs = [
      '--host',
      '0.0.0.0',
      '--port',
      port,
      '--model',
      resolvedModelPath,
      '--ctx-size',
      (contextSize ?? config.llm.contextSize).toString(),
    ];

    if (thinkingBudget !== null && thinkingBudget !== undefined) {
      spawnArgs.push('--reasoning-budget', thinkingBudget.toString());
    }

    if (numGpuLayers !== null && numGpuLayers !== undefined) {
      // Typically macOS users use binary which is either cpu only or metal;
      // but let's pass it anyway if explicitly set (metal will use offloading)
      spawnArgs.push('--n-gpu-layers', numGpuLayers.toString());
    }

    try {
      const child = spawn(binary, spawnArgs, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      this.serveProcess = child;
      child.on('exit', () => {
        if (this.serveProcess === child) {
          this.serveProcess = null;
        }
      });
      child.on('error', (err) => {
        console.warn(
          `[LlmRuntime:native] Detached serve process error: ${err.message}`
        );
      });
      console.log(
        `[LlmRuntime:native] Started detached llama-server with model ${resolvedModelPath}.`
      );
      return { executed: true, success: true };
    } catch (error) {
      const message = this.formatErrorOutput(error);
      console.error(
        `[LlmRuntime:native] Failed to spawn llama-server: ${message}`
      );
      return { executed: true, success: false, message };
    }
  }

  async ensureReady(timeoutMs = 30000): Promise<void> {
    console.log('[LlmRuntime:native] Ensuring service availability...');

    if (await this.isApiResponsive()) {
      console.log('[LlmRuntime:native] API already responsive.');
      return;
    }

    const { activeModelName } = await import('./activeModelService.js').then(
      (m) => ({ activeModelName: m.getActiveModel() })
    );

    const attempts: Array<{
      name: string;
      fn: () => Promise<StartAttemptOutcome>;
    }> = [
      {
        name: 'detached serve',
        fn: () => this.attemptStartViaServe(activeModelName),
      },
    ];

    const messages: string[] = [];
    const deadline = Date.now() + timeoutMs;

    for (const attempt of attempts) {
      const outcome = await attempt.fn();
      if (outcome.message) {
        messages.push(`${attempt.name}: ${outcome.message}`);
      }

      if (!outcome.executed) {
        continue;
      }

      if (outcome.success) {
        const remaining = Math.max(0, deadline - Date.now());
        const ready = await this.waitForReady(remaining);
        if (ready) {
          console.log(
            `[LlmRuntime:native] Service responsive after ${attempt.name}.`
          );
          return;
        }
        messages.push(
          `${attempt.name}: service not responsive within remaining timeout`
        );
      }
    }

    if (await this.isApiResponsive()) {
      return;
    }

    const detail = messages.length ? ` Attempts: ${messages.join('; ')}.` : '';
    throw new InternalServerError(
      `Failed to start native LLM service within ${timeoutMs}ms.${detail}`
    );
  }

  async deleteModel(modelPath: string): Promise<string> {
    if (!modelPath || !modelPath.trim()) {
      throw new InternalServerError('Model path required for deletion.');
    }
    const fullPath = path.resolve(config.llm.modelsDir, modelPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return `Deleted ${modelPath}`;
    }
    throw new NotFoundError(`Model file ${modelPath} not found`);
  }

  async restartWithModel(modelPath: string): Promise<void> {
    console.log(
      `[LlmRuntime:native] Restarting server with model ${modelPath}`
    );
    await this.stop();
    await delay(1000); // Give it a moment to release the port
    await this.ensureReady(-1); // This will attempt start
  }

  async stop(): Promise<void> {
    if (this.serveProcess && !this.serveProcess.killed) {
      try {
        process.kill(this.serveProcess.pid ?? 0, 'SIGTERM');
        console.log(
          `[LlmRuntime:native] Terminated serve process PID ${this.serveProcess.pid}`
        );
      } catch (error) {
        console.warn(
          `[LlmRuntime:native] Failed to stop serve process: ${(error as Error).message}`
        );
      } finally {
        this.serveProcess = null;
      }
    } else {
      // Find by name
      try {
        await execAsync('pkill -f llama-server');
        console.log(
          `[LlmRuntime:native] Terminated any running llama-server processes`
        );
      } catch (e) {
        // ignore
      }
    }
  }
}
