#!/usr/bin/env node
// Verify that native bindings for required dependencies are present.
// Runs as the root `postinstall` hook; fails loudly if a binding is missing
// so the failure surfaces during `yarn install` rather than at runtime.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const nodeModules = join(root, 'node_modules');

// Each entry: package name -> binding filename inside build/Release/.
const required = {
  'better-sqlite3': 'better_sqlite3.node',
};

let failed = 0;
for (const [pkg, binding] of Object.entries(required)) {
  const bindingPath = join(nodeModules, pkg, 'build', 'Release', binding);
  if (!existsSync(bindingPath)) {
    console.error('');
    console.error(`[check-native-bindings] MISSING native binding for ${pkg}.`);
    console.error(`  expected: ${bindingPath}`);
    console.error('');
    console.error('  This usually means one of:');
    console.error('    1. Wrong Node version. The project pins Node 23.10.0 in .nvmrc.');
    console.error('       Run `nvm use` to switch.');
    console.error('    2. `yarn install` was run with --ignore-scripts. Re-run without it.');
    console.error('    3. A previous install used a Node version without prebuilt binaries');
    console.error('       and no node-gyp fallback. Re-run `yarn install --force` on Node 23.10.0.');
    console.error('');
    failed += 1;
  }
}

if (failed > 0) {
  process.exit(1);
}

console.log('[check-native-bindings] OK');
