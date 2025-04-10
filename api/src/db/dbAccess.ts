// src/db/dbAccess.ts
import Database from 'better-sqlite3';
import { db } from './sqliteService.js';

// Simple wrapper to check database health
export const checkDatabaseHealth = (): void => {
  db.pragma('quick_check');
};

// Export the db instance if needed elsewhere, but we'll avoid using it directly in server.ts
export { db };
