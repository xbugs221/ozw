#!/usr/bin/env bash
# PURPOSE: Run a staged-change-aware quality gate before a commit is created.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

use_repository_node() {
  # PURPOSE: Match local commit checks to the Node.js version used by GitHub CI.
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

is_rebase_squash() {
  # PURPOSE: Avoid rerunning checks while Git only rewrites commits during a squash.
  [[ "${GIT_REFLOG_ACTION:-}" == rebase\ \(squash\)* ]]
}

is_non_code_path() {
  # PURPOSE: Classify documentation and static assets that need no executable checks.
  case "$1" in
    docs/*|assets/*|README*|CONTRIBUTING*|LICENSE|SECURITY.md|*.md|*.txt|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.webp)
      return 0
      ;;
  esac
  return 1
}

has_code_changes() {
  # PURPOSE: Detect whether staged files include changes beyond documentation and assets.
  local file
  for file in "$@"; do
    if ! is_non_code_path "$file"; then
      return 0
    fi
  done
  return 1
}

run_affected_tests() {
  # PURPOSE: Run only test files that are staged in the current commit.
  local runner test_file
  local -a unit_tests=() backend_tests=() node_specs=() browser_specs=() e2e_tests=()

  while IFS=$'\t' read -r runner test_file; do
    case "$runner" in
      unit) unit_tests+=("$test_file") ;;
      backend) backend_tests+=("$test_file") ;;
      node-spec) node_specs+=("$test_file") ;;
      browser-spec) browser_specs+=("$test_file") ;;
      e2e) e2e_tests+=("$test_file") ;;
      *) echo "[pre-commit] Unknown affected-test runner: $runner" >&2; exit 1 ;;
    esac
  done < <(node scripts/list-staged-tests.mjs "${staged_files[@]}")

  if ((${#unit_tests[@]})); then
    pnpm exec vitest run --config vitest.config.ts "${unit_tests[@]}"
  fi
  if ((${#backend_tests[@]})); then
    rm -rf .tmp/test-db/pre-commit-backend
    DATABASE_PATH=.tmp/test-db/pre-commit-backend/ozw.db pnpm exec tsx --test --test-concurrency=1 "${backend_tests[@]}"
  fi
  if ((${#node_specs[@]})); then
    rm -rf .tmp/test-db/pre-commit-spec
    DATABASE_PATH=.tmp/test-db/pre-commit-spec/ozw.db pnpm exec tsx --test "${node_specs[@]}"
  fi
  if ((${#browser_specs[@]})); then
    pnpm exec playwright test --config=playwright.spec.config.ts "${browser_specs[@]}"
  fi
  if ((${#e2e_tests[@]})); then
    pnpm exec playwright test "${e2e_tests[@]}"
  fi

  if (( ${#unit_tests[@]} + ${#backend_tests[@]} + ${#node_specs[@]} + ${#browser_specs[@]} + ${#e2e_tests[@]} == 0 )); then
    echo "[pre-commit] No affected test files found; CI remains the complete gate."
  fi
}

if is_rebase_squash; then
  echo "[pre-commit] Skipping checks for interactive-rebase squash."
  exit 0
fi

if git diff --cached --quiet; then
  echo "[pre-commit] Skipping checks: the staged tree is unchanged."
  exit 0
fi

mapfile -d '' staged_files < <(git diff --cached --name-only -z)

if ! has_code_changes "${staged_files[@]}"; then
  echo "[pre-commit] Skipping checks: only documentation or static assets changed."
  exit 0
fi

use_repository_node

echo "[pre-commit] Running only staged test files..."
run_affected_tests

echo "[pre-commit] Required checks passed."
