// packages/db/src/types.ts

/**
 * A generic interface representing the result of a database 'run' operation,
 * such as an INSERT, UPDATE, or DELETE statement.
 */
export interface DbRunResult {
  /** The number of rows that were changed by the operation. */
  changes: number;
  /** The rowid of the last row inserted into the database. */
  lastInsertRowid: number | bigint;
}

/**
 * A generic interface representing a prepared database statement.
 * This abstracts the underlying driver's statement object.
 * The method signatures are designed to be compatible with better-sqlite3's Statement.
 */
export interface DbStatement {
  /** Executes the prepared statement, returning information about the execution. */
  run(...params: any[]): DbRunResult;

  /** Executes the prepared statement, returning the first row of the result set. */
  get(...params: any[]): any;

  /** Executes the prepared statement, returning an array of all result rows. */
  all(...params: any[]): any[];

  // Note: Other methods like `iterate` or `bind` could be added here if needed
  // by consumer packages, but are omitted for now to keep the abstraction minimal.
}
