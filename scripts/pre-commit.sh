#!/usr/bin/env bash
# PURPOSE: Run the exact GitHub Node quality gate before a commit is created.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

use_repository_node() {
  # PURPOSE: Match local commits to the exact Node.js version used by GitHub CI.
  local required_node current_node
  required_node="$(tr -d '[:space:]' < .nvmrc)"
  current_node="v$(node -p 'process.versions.node')"
  if [[ "$current_node" == "$required_node" ]]; then
    return
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "[pre-commit] Node.js $required_node is required; current version is $current_node." >&2
    echo "[pre-commit] Install nvm and run: nvm install $required_node" >&2
    exit 1
  fi

  set +e
  set +u
  # shellcheck source=/dev/null
  source "$NVM_DIR/nvm.sh" || true
  set -e
  set -u
  nvm use --silent "$required_node" >/dev/null
}

use_repository_node

echo "[pre-commit] Running the complete GitHub CI gate..."
pnpm run test:ci

echo "[pre-commit] All CI checks passed."
