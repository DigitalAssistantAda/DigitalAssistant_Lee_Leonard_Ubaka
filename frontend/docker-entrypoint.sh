#!/bin/sh
set -e
cd /app

# Bind-mounted ./frontend + /app/node_modules volume can desync from package.json.
if ! node -e "require.resolve('react/package.json')" 2>/dev/null; then
  echo "frontend: installing npm dependencies (node_modules missing or empty)..."
  npm install
fi

exec "$@"
