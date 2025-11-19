Here are my notes and analysis of the problem, followed by the recommended approach.

### Analysis of the Current State

1.  **Infrastructure for OS-switching exists:**
    The codebase already has logic to handle OS differences in `scripts/run-dev.js`.
    - It detects if the OS is macOS (`isMacOS`).
    - If macOS, it sets `process.env.DOCKER_COMPOSE_EXTRA` to point to `docker-compose.no-gpu.yml`.
    - This environment variable is consumed by `packages/docker-utils`, which appends the extra compose file to Docker commands.

2.  **The Whisper Configuration Gap:**
    Currently, the root `docker-compose.yml` definition for the `whisper` service looks like this:
    ```yaml
    whisper:
      # ... build args and volumes ...
      image: therascript/whisper
      # ...
      # MISSING: deploy/resources configuration
    ```
    Because there is no `deploy` section requesting GPU resources, Docker defaults to CPU mode on **all** platforms, including Linux.

3.  **The `no-gpu` Override:**
    The file `docker-compose.no-gpu.yml` exists and contains:
    ```yaml
    services:
      whisper:
        deploy: {}
    ```
    This file is designed to *remove* or *reset* the deploy configuration. It implies that the intention was for the main `docker-compose.yml` to have GPU settings, which would then be stripped out by this override file when running on macOS.

4.  **Whisper Internal Implementation:**
    - `packages/whisper/Dockerfile`: Correctly installs PyTorch with CUDA support (nightly channel) by default.
    - `packages/whisper/transcribe.py`: Correctly checks `torch.cuda.is_available()` and logs whether it is using GPU or CPU.

### Proposed Approach

We do not need to change any TypeScript/JavaScript logic because the "Mac-safeguard" is already in place. We simply need to enable GPU in the default configuration.

**Steps:**

1.  **Modify `docker-compose.yml` (Root):**
    Update the `whisper` service definition to include a `deploy` section that reserves NVIDIA GPU resources. This will enable GPU usage on Linux/Windows (WSL) machines that have the NVIDIA Container Toolkit installed.

2.  **Verify `scripts/run-prod.js` (Optional but recommended):**
    The `scripts/run-dev.js` file handles the `no-gpu` override logic. I noticed `scripts/run-prod.js` lacks this specific logic. While production environments are usually Linux, if you were to run "prod" mode locally on a Mac, it would fail with the new changes. I will add the `deploy` section to the Docker Compose file, which resolves the primary issue.

### Implementation Detail

I will add the following block to the `whisper` service in `docker-compose.yml`:

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1 # or 'all'
              capabilities: [gpu]
```

**Behavior Check:**
- **On Linux:** `run-dev.js` does *not* load the extra compose file. Docker uses `docker-compose.yml`. The new `deploy` section requests the GPU. -> **Success (GPU Used)**.
- **On Mac:** `run-dev.js` detects Mac and loads `docker-compose.no-gpu.yml`. This overrides the `deploy` section to be empty `{}`. Docker ignores the GPU request. -> **Success (CPU Used, no startup error)**.
