#!/usr/bin/env bash
bash -i -c '
    set -e
    cd ~/dev/therascript/
    nvm use
    open http://localhost:3002
    yarn start
'
