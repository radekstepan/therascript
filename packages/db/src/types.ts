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

/**
 * A generic interface representing an open database connection.
 * This abstracts the underlying driver (better-sqlite3-multiple-ciphers)
 * so consumer packages never resolve the binding's module specifier —
 * only the method surface the codebase actually uses is exposed.
 */
export interface DbDatabase {
  /** False once the connection is closed. */
  readonly open: boolean;

  /** Compiles a statement; throws on invalid SQL or an unreadable (wrong-key) database. */
  prepare(source: string): DbStatement;

  /** Executes one or more semicolon-separated statements. */
  exec(source: string): void;

  /** Reads or sets a pragma. */
  pragma(source: string, options?: { simple?: boolean }): unknown;

  /** Wraps a function in a transaction; the wrapper keeps the input signature. */
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;

  /** Presents the raw database key. Absent on the stock better-sqlite3 binding. */
  key(key: Buffer): void;

  /** Re-keys the database in place (also encrypts a plaintext database). */
  rekey(key: Buffer): void;

  /** Closes the connection. */
  close(): void;
}
