import { Elysia } from 'elysia';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '@therascript/config';
import { getElasticsearchClient } from '@therascript/elasticsearch-client';
import { setupMiddleware } from './setupMiddleware.js';
import { setupRoutes } from './setupRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export let appVersion = '0.0.0';
try {
  const packageJsonPath = path.resolve(__dirname, '../package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    appVersion = packageJson.version || appVersion;
  }
} catch (error) {
  console.error('[App Init] Error reading package.json version:', error);
}

export const esClient = getElasticsearchClient(config.elasticsearch.url);

const app = new Elysia()
  .use(setupMiddleware(appVersion, esClient))
  .use(setupRoutes());

export default app;
export type App = typeof app;
