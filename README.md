# Therascript ✨

## Docker

Make sure Docker is installed

For WSL this means installing Docker Desktop https://docs.docker.com/desktop/features/wsl/ on linux this means installing the Community Edition

```bash
sudo usermod -aG docker $USER
```

## CUDA

Get CUDA Toolkit installed for your distro - https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local

Make sure to restart Windows even if you run WSL2.

Verify:

```bash
$ nvidia-smi
```

## Install

```bash
$ nvm use
$ yarn
$ yarn build
$ yarn dev # OR yarn start
```

Wait! You can see the install progress for `packages/whisper` inside Docker Desktop.

Then visit http://localhost:3002/

If you need to rebuild the `whisper` package:

```sh
$ docker compose -f ./docker-compose.yml build whisper
```
