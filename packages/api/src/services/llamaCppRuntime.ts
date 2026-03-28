import axios from 'axios';
import {
  exec as callbackExec,
  execFile as callbackExecFile,
} from 'node:child_process';
import * as util from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import config from '@therascript/config';
import { InternalServerError, NotFoundError } from '../errors.js';

const execAsync = util.promisify(callbackExec);
const execFileAsync = util.promisify(callbackExecFile);

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export type LlmRuntimeType = 'native';

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
  cachedRuntime = new LmStudioRuntime();
  return cachedRuntime;
};

/**
 * LmStudioRuntime — native runtime using llmster (LM Studio's headless engine).
 *
 * Manages the llmster daemon and HTTP server via the `lms` CLI.
 * Model loading / unloading is handled separately via the LM Studio REST API
 * in llamaCppService.ts after this runtime confirms the server is up.
 *
 * Install: curl -fsSL https://lmstudio.ai/install.sh | bash
 */
class LmStudioRuntime implements LlmRuntime {
  readonly type: LlmRuntimeType = 'native';

  private async findLmsBinary(): Promise<string | null> {
    const candidates: string[] = [
      ...(process.env.LMS_BINARY_PATH ? [process.env.LMS_BINARY_PATH] : []),
      path.join(os.homedir(), '.lmstudio', 'bin', 'lms'),
      '/usr/local/bin/lms',
      '/opt/homebrew/bin/lms',
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    try {
      const { stdout } = await execAsync('which lms');
      const resolved = stdout.trim();
      if (resolved) return resolved;
    } catch {
      // not in PATH
    }
    return null;
  }

  private async runLms(
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string }> {
    const binary = await this.findLmsBinary();
    if (!binary) {
      throw new InternalServerError(
        'lms binary not found. Install LM Studio via: curl -fsSL https://lmstudio.ai/install.sh | bash'
      );
    }
    return execFileAsync(binary, args);
  }

  private async isApiResponsive(): Promise<boolean> {
    try {
      const res = await axios.get(`${config.llm.baseURL}/api/v1/models`, {
        timeout: 3000,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    if (timeoutMs <= 0) return this.isApiResponsive();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.isApiResponsive()) return true;
      await delay(2000);
    }
    return false;
  }

  async ensureReady(timeoutMs = 30000): Promise<void> {
    console.log('[LmStudioRuntime] Ensuring LM Studio service...');

    if (await this.isApiResponsive()) {
      console.log('[LmStudioRuntime] API already responsive.');
      return;
    }

    // Start the llmster daemon
    try {
      console.log('[LmStudioRuntime] Starting llmster daemon...');
      await this.runLms('daemon', 'up');
    } catch (e: any) {
      // Daemon may already be running; non-fatal
      console.warn(`[LmStudioRuntime] daemon up: ${e.message}`);
    }

    // Start the HTTP server
    const port = (() => {
      try {
        return new URL(config.llm.baseURL).port || '1234';
      } catch {
        return '1234';
      }
    })();
    try {
      console.log(
        `[LmStudioRuntime] Starting LM Studio server on port ${port}...`
      );
      await this.runLms('server', 'start', '--port', port);
    } catch (e: any) {
      // Server may already be running; non-fatal
      console.warn(`[LmStudioRuntime] server start: ${e.message}`);
    }

    const ready = await this.waitForReady(Math.max(timeoutMs - 2000, 10000));
    if (!ready) {
      throw new InternalServerError(
        `LM Studio server not responsive after ${timeoutMs}ms. ` +
          'Ensure llmster is installed: curl -fsSL https://lmstudio.ai/install.sh | bash'
      );
    }
    console.log('[LmStudioRuntime] Service is ready.');
  }

  async deleteModel(modelKey: string): Promise<string> {
    // LM Studio stores models in ~/.lmstudio/models/<publisher>/<model-name>/
    const modelsBase = path.join(os.homedir(), '.lmstudio', 'models');
    const parts = modelKey
      .replace(/\\/g, '/')
      .split('/')
      .filter((p) => p.length > 0);
    const targetPath =
      parts.length >= 2
        ? path.join(modelsBase, ...parts)
        : path.join(modelsBase, modelKey);

    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(targetPath);
      }
      return `Deleted model ${modelKey}`;
    }
    throw new NotFoundError(
      `Model ${modelKey} not found in ~/.lmstudio/models/`
    );
  }

  async restartWithModel(modelKey: string): Promise<void> {
    console.log(`[LmStudioRuntime] Preparing to load model: ${modelKey}`);
    // Ensure the daemon + server are up.
    // Actual unload/load is handled in llamaCppService.ts via REST API.
    await this.ensureReady(30000);
  }

  async stop(): Promise<void> {
    try {
      await this.runLms('server', 'stop');
      console.log('[LmStudioRuntime] Server stopped.');
    } catch (e: any) {
      console.warn(`[LmStudioRuntime] Failed to stop server: ${e.message}`);
    }
    try {
      await this.runLms('daemon', 'down');
      console.log('[LmStudioRuntime] Daemon stopped, model memory freed.');
    } catch (e: any) {
      console.warn(`[LmStudioRuntime] Failed to stop daemon: ${e.message}`);
    }
  }
}
