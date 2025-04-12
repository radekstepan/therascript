import { db } from './sqliteService.js';

// TODO move to sqliteService
// Simple wrapper to check database health
export const checkDatabaseHealth = (): void => {
  db.pragma('quick_check');
};

export { db };
