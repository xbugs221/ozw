#!/bin/sh
# PURPOSE: Run the local development watchers for frontend rebuilds, backend
# auto-restart, and TypeScript diagnostics without polluting the production service.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$PROJECT_ROOT"

exec pnpm exec concurrently \
  --kill-others-on-fail \
  --names typecheck,server,client \
  --prefix name \
  "pnpm exec tsc --noEmit -p tsconfig.json --watch --preserveWatchOutput" \
  "pnpm exec tsx watch backend/index.ts" \
  "vite build --watch"
