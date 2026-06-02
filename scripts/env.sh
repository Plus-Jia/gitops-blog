#!/usr/bin/env bash

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PROJECT_ROOT/.tools/node-v22/bin:$PATH"

echo "Node: $(node -v)"
echo "npm: $(npm -v)"
