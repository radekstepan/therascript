#!/usr/bin/env node
// scripts/wipe-data.js

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  getElasticsearchClient,
  deleteIndex,
  initializeIndices,
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
} from '@therascript/elasticsearch-client';
import { closeDb, configureDb } from '@therascript/db';
import config from '../packages/config/dist/index.js';
import fs from 'node:fs/promises';

async function main() {
  const rl = readline.createInterface({ input, output });

  // Configure database to get correct paths
  configureDb({
    dbPath: config.db.sqlitePath,
    isDev: config.server.nodeEnv !== 'production',
  });

  console.log('📍 Target Paths:');
  console.log(`   - Database: ${config.db.sqlitePath}`);
  console.log(`   - Uploads: ${config.db.uploadsDir}`);
  console.log(`   - Elasticsearch: ${config.elasticsearch.url}`);

  console.log(
    '\n⚠️  WARNING: This will wipe ALL database records, Elasticsearch indices, and uploaded files.'
  );
  const answer = await rl.question(
    'Are you sure you want to proceed? (type "yes" to confirm): '
  );
  rl.close();

  if (answer.toLowerCase() !== 'yes') {
    console.log('Aborted.');
    return;
  }

  console.log('\n🚀 Starting full data wipe...');

  // 1. Clear Elasticsearch
  try {
    console.log(
      `Clearing Elasticsearch indices at ${config.elasticsearch.url}...`
    );
    const esClient = getElasticsearchClient(config.elasticsearch.url);
    await deleteIndex(esClient, TRANSCRIPTS_INDEX).catch(() => {});
    await deleteIndex(esClient, MESSAGES_INDEX).catch(() => {});
    await initializeIndices(esClient);
    console.log('✅ Elasticsearch indices reset.');
  } catch (error) {
    console.error('❌ Error clearing Elasticsearch:', error.message);
  }

  // 2. Clear Uploads
  try {
    const uploadsDir = config.db.uploadsDir;
    console.log(`Clearing uploads directory: ${uploadsDir}`);
    await fs.rm(uploadsDir, { recursive: true, force: true });
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log('✅ Uploads directory cleared.');
  } catch (error) {
    console.error('❌ Error clearing uploads:', error.message);
  }

  // 3. Delete SQLite Database
  try {
    const dbPath = config.db.sqlitePath;
    console.log(`Deleting SQLite database: ${dbPath}`);
    // Close any potential connections first
    closeDb();

    // Check if files exist (including WAL/SHM)
    const filesToDelete = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];

    for (const file of filesToDelete) {
      await fs.unlink(file).catch(() => {});
    }
    console.log('✅ SQLite database deleted.');
  } catch (error) {
    console.error('❌ Error deleting SQLite database:', error.message);
  }

  console.log(
    '\n✨ Data wipe complete. The database will be re-initialized on next application start.\n'
  );
}

main().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
