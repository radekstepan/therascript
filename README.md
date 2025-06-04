# Therascript ✨

## Docker

Make sure Docker is installed

For WSL this means installing Docker Desktop https://docs.docker.com/desktop/features/wsl/ on linux this means installing the Community Edition

```bash
sudo usermod -aG docker $USER
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
