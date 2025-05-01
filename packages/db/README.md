# Database Package (`packages/db`) - Placeholder

This package was originally intended to contain shared database access logic (e.g., schemas, repositories, migrations) that could potentially be used by multiple packages within the Therascript monorepo.

**Current Status:** As of now, this package is a **placeholder**. All database-related functionality, including:

*   SQLite database connection (`better-sqlite3`)
*   Schema definition and initialization/migration
*   Data repositories (for sessions, chats, messages, transcripts)
*   Full-Text Search (FTS) setup and querying

... is implemented directly within the **`packages/api`** backend service.

If the application evolves to require database access from other packages (e.g., a separate reporting tool, a standalone data migration script), this package could be developed to centralize that logic. For the current architecture, refer to the `packages/api/src/db/` and `packages/api/src/repositories/` directories for database implementation details.
