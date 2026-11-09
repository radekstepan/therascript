// packages/vault/src/cliPassword.ts
//
// Password acquisition for CLI and maintenance utilities:
// explicit env var, a supplied file descriptor (e.g. process substitution
// or a secret pipe), or an interactive no-echo TTY prompt — never argv,
// never logs.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { VaultStateError } from './errors.js';

export const VAULT_PASSWORD_ENV = 'THERASCRIPT_VAULT_PASSWORD';
export const VAULT_PASSWORD_FD_ENV = 'THERASCRIPT_VAULT_PASSWORD_FD';

function stripTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

/**
 * Returns the password from `THERASCRIPT_VAULT_PASSWORD` (preferred) or
 * from the file descriptor named by `THERASCRIPT_VAULT_PASSWORD_FD`,
 * or null when neither is configured. Empty values count as missing.
 */
export function readPasswordFromEnvOrFd(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const direct = env[VAULT_PASSWORD_ENV];
  if (typeof direct === 'string' && direct !== '') return direct;
  const fdRaw = env[VAULT_PASSWORD_FD_ENV];
  if (typeof fdRaw !== 'string' || fdRaw === '') return null;
  const fd = Number.parseInt(fdRaw, 10);
  if (!Number.isInteger(fd) || fd < 0) {
    throw new VaultStateError(
      `Invalid ${VAULT_PASSWORD_FD_ENV}: ${JSON.stringify(fdRaw)}`
    );
  }
  const content = stripTrailingNewline(readFileSync(fd, 'utf8'));
  return content === '' ? null : content;
}

export interface TtyLike {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void
  ) => void;
  pause?: () => void;
  resume?: () => void;
}

/**
 * Secure interactive prompt with echo disabled. Resolves to the entered
 * password (without the trailing newline). Rejects when stdin is not a TTY.
 */
export function promptForPassword(
  prompt = 'Vault password: ',
  streams: {
    input?: NodeJS.ReadableStream & Partial<TtyLike>;
    output?: NodeJS.WritableStream;
  } = {}
): Promise<string> {
  const input = (streams.input ?? process.stdin) as NodeJS.ReadableStream &
    TtyLike;
  const output = streams.output ?? process.stdout;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new VaultStateError(
        'Cannot prompt for the vault password: stdin is not a TTY. ' +
          `Set ${VAULT_PASSWORD_ENV} or ${VAULT_PASSWORD_FD_ENV} instead.`
      )
    );
  }
  return new Promise<string>((resolve) => {
    output.write(prompt);
    const rl = createInterface({
      input: input as NodeJS.ReadableStream,
      output,
    });
    // Mute echo: readline writes each keystroke to `output` unless the
    // output write is suppressed. The documented trick is overriding the
    // internal `_writeToOutput`.
    const mutable = rl as unknown as { _writeToOutput?: (s: string) => void };
    const originalWrite = mutable._writeToOutput?.bind(rl);
    mutable._writeToOutput = (s: string) => {
      // Swallow everything except the newline that ends the prompt line.
      if (s.includes('\n') || s.includes('\r')) originalWrite?.(s);
    };
    rl.question('', (answer: string) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
  });
}
