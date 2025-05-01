# System Management Package (`packages/system`)

This package provides Node.js scripts for managing system-level operations related to the Therascript application deployment, primarily targeting Linux environments using `systemd`.

## Purpose

*   **Autostart Management:** Create, remove, and check the status of a `systemd` service file to automatically start the main Therascript application (via a wrapper script) on system boot.
*   **System Shutdown:** Provide a mechanism (triggered via the API) to initiate a graceful system shutdown.

## Key Scripts & Functionality

*   **`src/autostartManager.ts`:** Contains the core logic for interacting with `systemctl` to enable, disable, and check service status. It generates the `.service` file content.
*   **`src/setupAutostart.ts`:** (Executable via `yarn autostart:setup`)
    *   Checks if the service (`therascript-app.service`) is already enabled.
    *   If not, it generates a `systemd` service file pointing to the compiled `startAppWrapper.js`.
    *   Writes the service file to `/etc/systemd/system/`.
    *   Reloads the `systemd` daemon and enables the service.
    *   **Requires `sudo` privileges.**
*   **`src/removeAutostartScript.ts`:** (Executable via `yarn autostart:remove`)
    *   Disables the `therascript-app.service`.
    *   Removes the service file from `/etc/systemd/system/`.
    *   Reloads the `systemd` daemon.
    *   **Requires `sudo` privileges.**
*   **`src/checkAutostartStatus.ts`:** (Executable via `yarn autostart:status`)
    *   Checks if the `therascript-app.service` is enabled using `systemctl is-enabled`.
    *   Prints the status to the console.
    *   **Requires `sudo` privileges.**
*   **`src/startAppWrapper.ts`:** (Executable via `yarn app:start:wrapper` or the `systemd` service)
    *   A simple Node.js script designed to be the entry point for the `systemd` service.
    *   It determines the project root directory.
    *   It spawns the main application start command (`yarn start` from the project root) as a child process.
    *   It passes through stdio and handles signals (SIGINT, SIGTERM) to attempt graceful shutdown of the child process.
*   **`src/shutdown.ts` / `src/shutdownTrigger.ts`:**
    *   `shutdown.ts`: Contains the function (`shutdownSystem`) that executes `shutdown -P now`.
    *   `shutdownTrigger.ts`: (Executable via `yarn trigger:shutdown` or called by the API) A simple script that calls `shutdownSystem`.
    *   **Requires passwordless `sudo` privileges configured specifically for the user running the API process to execute `node /path/to/packages/system/dist/shutdownTrigger.js`.** See `packages/api/src/services/systemService.ts` for details on `visudo` configuration. Use with extreme caution.

## Prerequisites

*   Node.js (Version specified in root `.nvmrc`)
*   Linux system with `systemd`.
*   `sudo` privileges for setup, removal, status check, and shutdown trigger scripts.
*   Specific passwordless `sudo` configuration for the shutdown feature if used via the API.
*   `yarn` executable available in the `PATH` of the user running the `systemd` service (or adjust `startAppWrapper.ts`).
*   Correct Node.js version (matching `.nvmrc`) installed for the user running the service (see NVM path logic in `autostartManager.ts`).

## Usage (from Project Root)

1.  **Build the package:** `yarn build:system`
2.  **Setup Autostart:** `yarn autostart:setup` (Requires sudo)
3.  **Check Status:** `yarn autostart:status` (Requires sudo)
4.  **Remove Autostart:** `yarn autostart:remove` (Requires sudo)
5.  **Run Wrapper Manually (for testing):** `yarn app:start:wrapper`
6.  **Trigger Shutdown Manually (for testing):** `sudo node packages/system/dist/shutdownTrigger.js` (Requires sudo)
