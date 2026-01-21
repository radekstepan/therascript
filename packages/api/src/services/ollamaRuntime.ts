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

export type OllamaRuntimeType = 'docker' | 'native';

export interface OllamaRuntime {
  readonly type: OllamaRuntimeType;
  ensureReady(timeoutMs?: number): Promise<void>;
  deleteModel(modelName: string): Promise<string>;
  stop?(): Promise<void>;
}

let cachedRuntime: OllamaRuntime | null = null;

export const getOllamaRuntime = (): OllamaRuntime => {
  if (cachedRuntime) {
    return cachedRuntime;
  }
  if (config.ollama.runtime === 'native') {
    cachedRuntime = new NativeOllamaRuntime();
  } else {
    cachedRuntime = new DockerOllamaRuntime();
  }
  return cachedRuntime;
};

class DockerOllamaRuntime implements OllamaRuntime {
  readonly type: OllamaRuntimeType = 'docker';

  private readonly composeFilePath: string;
  private readonly serviceName = 'ollama';
  private readonly containerName = 'ollama_server_managed';
  private readonly composeDir: string;

  constructor() {
    const packageDir = path.resolve(
      fileURLToPath(import.meta.url),
      '../../../..',
      'ollama'
    );
    this.composeFilePath = path.join(packageDir, 'docker-compose.yml');
    this.composeDir = path.dirname(this.composeFilePath);
  }

  private ensureComposeFileExists(): void {
    if (!fs.existsSync(this.composeFilePath)) {
      throw new InternalServerError(
        `Ollama docker-compose.yml not found at ${this.composeFilePath}`
      );
    }
  }

  private resolveComposeCommand(command: string): string {
    const extraCompose = process.env.DOCKER_COMPOSE_EXTRA;
    const packageNoGpuOverride = path.join(
      this.composeDir,
      'docker-compose.no-gpu.yml'
    );
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
          `[OllamaRuntime:docker] Ignoring DOCKER_COMPOSE_EXTRA ${extraCompose} because it is not in ${this.composeDir}.`
        );
      }
    } else {
      const onLinux = process.platform === 'linux' || isWSL();
      if (onLinux && !process.env.OLLAMA_DISABLE_GPU) {
        if (fs.existsSync(packageGpuOverride)) {
          chosenExtra = packageGpuOverride;
        }
      } else if (process.platform === 'darwin') {
        if (fs.existsSync(packageNoGpuOverride)) {
          chosenExtra = packageNoGpuOverride;
        }
      }
    }

    const extraFlag = chosenExtra ? ` -f "${chosenExtra}"` : '';
    return `docker compose -f "${this.composeFilePath}"${extraFlag} ${command}`;
  }

  private async runCompose(command: string): Promise<string> {
    this.ensureComposeFileExists();
    const composeCommand = this.resolveComposeCommand(command);
    console.log(`[OllamaRuntime:docker] Running: ${composeCommand}`);
    try {
      const { stdout, stderr } = await execAsync(composeCommand);
      if (stderr && !stderr.toLowerCase().includes('warn')) {
        console.warn(`[OllamaRuntime:docker] stderr: ${stderr}`);
      }
      return stdout.trim();
    } catch (error: any) {
      console.error(
        `[OllamaRuntime:docker] Command failed: ${composeCommand}`,
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
        '[OllamaRuntime:docker] Failed to determine container status. Assuming not running.'
      );
      return false;
    }
  }

  private async isApiResponsive(): Promise<boolean> {
    try {
      await axios.get(config.ollama.baseURL, { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  async ensureReady(timeoutMs = 30000): Promise<void> {
    console.log('[OllamaRuntime:docker] Ensuring service availability...');

    const containerRunning = await this.isContainerRunning();
    if (containerRunning && (await this.isApiResponsive())) {
      console.log(
        '[OllamaRuntime:docker] Container is running and API is responsive.'
      );
      return;
    }

    if (!containerRunning) {
      console.log(
        '[OllamaRuntime:docker] Container not running. Attempting to start...'
      );
      try {
        await this.runCompose(`up -d ${this.serviceName}`);
      } catch (error: any) {
        throw new InternalServerError(
          'Failed to start Ollama Docker service.',
          error instanceof Error ? error : undefined
        );
      }
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.isApiResponsive()) {
        console.log('[OllamaRuntime:docker] API is now responsive.');
        return;
      }
      console.log('[OllamaRuntime:docker] Waiting for API to respond...');
      await delay(3000);
    }

    throw new InternalServerError(
      `Ollama Docker service did not become responsive within ${timeoutMs}ms.`
    );
  }

  async deleteModel(modelName: string): Promise<string> {
    if (!modelName.trim()) {
      throw new InternalServerError('Model name required for deletion.');
    }
    return this.runCompose(
      `exec -T ${this.serviceName} ollama rm ${modelName}`
    );
  }
}

class NativeOllamaRuntime implements OllamaRuntime {
  readonly type: OllamaRuntimeType = 'native';

  private resolvedBinary: string | null = null;
  private serveProcess: ChildProcess | null = null;

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
    if (this.resolvedBinary) {
      return this.resolvedBinary;
    }

    const candidates: Array<string | null | undefined> = [
      process.env.OLLAMA_BINARY_PATH,
      await this.locateCommand('ollama'),
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      '/Applications/Ollama.app/Contents/MacOS/Ollama',
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (fs.existsSync(candidate)) {
        this.resolvedBinary = candidate;
        return candidate;
      }
    }

    throw new InternalServerError(
      'Ollama binary not found. Install Ollama locally or set OLLAMA_BINARY_PATH.'
    );
  }

  private async isApiResponsive(): Promise<boolean> {
    try {
      await axios.get(config.ollama.baseURL, { timeout: 2500 });
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

  private async attemptStartViaBrew(): Promise<StartAttemptOutcome> {
    const brewPath = await this.locateCommand('brew');
    if (!brewPath) {
      return {
        executed: false,
        success: false,
        message: 'brew not found',
      };
    }
    try {
      await execFileAsync(brewPath, ['services', 'start', 'ollama']);
      console.log('[OllamaRuntime:native] Started via brew services.');
      return { executed: true, success: true };
    } catch (error) {
      const message = this.formatErrorOutput(error);
      console.warn(
        `[OllamaRuntime:native] brew services start failed: ${message}`
      );
      return { executed: true, success: false, message };
    }
  }

  private async attemptStartViaLaunchctl(): Promise<StartAttemptOutcome> {
    const launchctlPath = await this.locateCommand('launchctl');
    if (!launchctlPath || process.platform !== 'darwin') {
      return {
        executed: false,
        success: false,
        message: 'launchctl unavailable',
      };
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const serviceName = `gui/${uid}/com.ollama`;
    try {
      await execFileAsync(launchctlPath, ['kickstart', '-k', serviceName]);
      console.log('[OllamaRuntime:native] launchctl kickstart issued.');
      return { executed: true, success: true };
    } catch (error) {
      const message = this.formatErrorOutput(error);
      console.warn(
        `[OllamaRuntime:native] launchctl kickstart failed: ${message}`
      );
      return { executed: true, success: false, message };
    }
  }

  private async attemptStartViaServe(): Promise<StartAttemptOutcome> {
    if (this.serveProcess && !this.serveProcess.killed) {
      return {
        executed: true,
        success: true,
        message: 'serve process already running',
      };
    }

    const binary = await this.resolveBinary();
    try {
      const child = spawn(binary, ['serve'], {
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
          `[OllamaRuntime:native] Detached serve process error: ${err.message}`
        );
      });
      console.log('[OllamaRuntime:native] Started detached `ollama serve`.');
      return { executed: true, success: true };
    } catch (error) {
      const message = this.formatErrorOutput(error);
      console.error(
        `[OllamaRuntime:native] Failed to spawn ollama serve: ${message}`
      );
      return { executed: true, success: false, message };
    }
  }

  async ensureReady(timeoutMs = 30000): Promise<void> {
    console.log('[OllamaRuntime:native] Ensuring service availability...');

    if (await this.isApiResponsive()) {
      console.log('[OllamaRuntime:native] API already responsive.');
      return;
    }

    const attempts: Array<{
      name: string;
      fn: () => Promise<StartAttemptOutcome>;
    }> = [
      { name: 'brew services', fn: () => this.attemptStartViaBrew() },
      {
        name: 'launchctl kickstart',
        fn: () => this.attemptStartViaLaunchctl(),
      },
      { name: 'detached serve', fn: () => this.attemptStartViaServe() },
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
            `[OllamaRuntime:native] Service responsive after ${attempt.name}.`
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
      `Failed to start native Ollama service within ${timeoutMs}ms.${detail}`
    );
  }

  async deleteModel(modelName: string): Promise<string> {
    if (!modelName.trim()) {
      throw new InternalServerError('Model name required for deletion.');
    }
    const binary = await this.resolveBinary();
    try {
      const { stdout, stderr } = await execFileAsync(binary, ['rm', modelName]);
      return `${stdout ?? ''}${stderr ?? ''}`.trim();
    } catch (error: any) {
      const combined = this.formatErrorOutput(error).toLowerCase();
      if (combined.includes('not found')) {
        throw new NotFoundError(`Model '${modelName}' not found locally.`);
      }
      throw new InternalServerError(
        `Failed to delete model '${modelName}' via native runtime.`,
        error instanceof Error ? error : undefined
      );
    }
  }

  async stop(): Promise<void> {
    if (this.serveProcess && !this.serveProcess.killed) {
      try {
        process.kill(this.serveProcess.pid ?? 0, 'SIGTERM');
      } catch (error) {
        console.warn(
          `[OllamaRuntime:native] Failed to stop serve process: ${(error as Error).message}`
        );
      } finally {
        this.serveProcess = null;
      }
    }
  }
}
