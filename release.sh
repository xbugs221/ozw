#!/usr/bin/env bash
# PURPOSE: Tag and push the latest clean main commit to start the release workflow.
set -euo pipefail

usage() {
  # PURPOSE: Show the one-command stable release flow.
  cat <<'USAGE'
Usage: ./release.sh <version>

Example:
  ./release.sh 1.4.23

The command tags and pushes the current main commit. The release workflow
sets the package version from that tag and publishes the tested package.
USAGE
}

main() {
  # PURPOSE: Validate release intent before creating or pushing a release tag.
  if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  local tag_name="v${1#v}"
  if [[ ! "${tag_name}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Release version must be stable SemVer (x.y.z): ${1}" >&2
    exit 1
  fi

  local repo_root
  repo_root="$(git rev-parse --show-toplevel)"
  cd "${repo_root}"

  if [[ "$(git branch --show-current)" != "main" ]]; then
    echo "Switch to main before releasing." >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree must be clean before release." >&2
    exit 1
  fi

  local local_main remote_main
  local_main="$(git rev-parse HEAD)"
  remote_main="$(git ls-remote --heads origin refs/heads/main | awk 'NR == 1 { print $1 }')"
  if [[ -z "${remote_main}" || "${local_main}" != "${remote_main}" ]]; then
    echo "Update main from origin/main before releasing." >&2
    exit 1
  fi

  if git rev-parse -q --verify "refs/tags/${tag_name}" >/dev/null || \
    [[ -n "$(git ls-remote --tags origin "refs/tags/${tag_name}" "refs/tags/${tag_name}^{}")" ]]; then
    echo "Tag already exists: ${tag_name}" >&2
    exit 1
  fi

  git tag -a "${tag_name}" -m "Release ${tag_name}"
  git push origin "${tag_name}"
  echo "Pushed ${tag_name}; GitHub Actions will build and publish the release."
}

main "$@"
