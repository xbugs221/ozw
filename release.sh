#!/usr/bin/env bash
# PURPOSE: Prepare a release commit with agent-written CHANGELOG content, then tag it.
set -euo pipefail

usage() {
  # PURPOSE: Show the supported release command shape.
  cat <<'USAGE'
Usage: ./release.sh <version>

Examples:
  ./release.sh v1.0
  ./release.sh 1.1.0

The script updates package.json, asks an agent to update CHANGELOG.md,
creates a release commit, and tags that commit. Override the agent with:
  CHANGELOG_AGENT_CMD='codex exec --ephemeral --ask-for-approval never --sandbox read-only -'
USAGE
}

normalize_package_version() {
  # PURPOSE: Convert a release tag such as v1.0 into an npm-compatible package version.
  local raw="${1#v}"
  local dot_count
  dot_count="$(grep -o '\.' <<<"$raw" | wc -l | tr -d ' ')"
  if [[ "$dot_count" == "1" ]]; then
    printf '%s.0\n' "$raw"
  else
    printf '%s\n' "$raw"
  fi
}

main() {
  # PURPOSE: Run the complete local release workflow.
  if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  local release_input="$1"
  local tag_name="v${release_input#v}"
  local package_version
  package_version="$(normalize_package_version "$release_input")"

  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  cd "$repo_root"

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Working tree must be clean before release." >&2
    exit 1
  fi
  if git rev-parse -q --verify "refs/tags/$tag_name" >/dev/null; then
    echo "Tag already exists: $tag_name" >&2
    exit 1
  fi

  node -e "
const fs = require('fs');
const path = 'package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
pkg.version = '$package_version';
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

  if [[ -n "$(git tag --list)" ]]; then
    pnpm run changelog:update -- --version "$tag_name"
    git add package.json CHANGELOG.md
  else
    echo "Skipping CHANGELOG for first release tag $tag_name."
    git add package.json
  fi

  if git diff --cached --quiet; then
    echo "No release changes were produced." >&2
    exit 1
  fi

  git commit -m "Release $tag_name"
  git tag -a "$tag_name" -m "Release $tag_name"
  echo "Created release tag $tag_name"
}

main "$@"
