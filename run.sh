#!/usr/bin/env bash
set -e

# Load NVM manually
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Ensure system binaries are visible first
export PATH="/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin:$NVM_DIR/versions/node/$(nvm version)/bin:$PATH"

cd "$HOME/dev/therascript"

nvm use

# Open browser
xdg-open http://localhost:3002 >/dev/null 2>&1 &

echo "PATH in run.sh before yarn start: $PATH"

# Start Node app — Node now sees Docker
yarn start
