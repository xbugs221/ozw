#!/usr/bin/env bash
# PURPOSE: Format staged source files, then run typecheck (same as CI).
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

collect_staged_files() {
  # PURPOSE: Return existing staged paths only, so deleted files do not reach Prettier.
  git diff --cached --name-only --diff-filter=ACMR -z -- |
    while IFS= read -r -d '' file_path; do
      if [[ -f "$file_path" ]]; then
        printf '%s\0' "$file_path"
      fi
    done
}

mapfile -d '' staged_files < <(collect_staged_files)

if (( ${#staged_files[@]} > 0 )); then
  echo "[pre-commit] Formatting staged files..."
  ./scripts/format-code.sh --staged
  git add -- "${staged_files[@]}"
else
  echo "[pre-commit] No staged files to format."
fi

echo "[pre-commit] Running typecheck (same as CI)..."
pnpm run typecheck

echo "[pre-commit] All checks passed."
