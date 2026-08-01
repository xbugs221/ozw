#!/bin/sh
# PURPOSE: Pull the latest ozw source, rebuild one shared image, and recreate
# both NAS viewers without touching Hermes data or ozw authentication volumes.

set -eu

STACK_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_DIR=/volume1/docker/src/ozw
SOURCE_PARENT=/volume1/docker/src
DOCKER=/var/packages/ContainerManager/target/usr/bin/docker
COMPOSE=/var/packages/ContainerManager/target/usr/bin/docker-compose
SOURCE_IMAGE=alpine/git
GIT_PROXY=${GIT_PROXY:-http://192.168.112.1:7897}

ensure_directories() {
  # Create only the deployment-owned directories required by this stack.
  mkdir -p "$SOURCE_PARENT" /volume1/docker/app-data/ozw-zzl /volume1/docker/app-data/ozw-dmh
}

sync_source() {
  # Use the already-installed alpine/git image because DSM does not expose git
  # in the SSH user's PATH; use the NAS's existing proxy for GitHub access.
  if [ ! -d "$SOURCE_DIR/.git" ]; then
    "$DOCKER" run --rm \
      -e HTTP_PROXY="$GIT_PROXY" -e HTTPS_PROXY="$GIT_PROXY" -e ALL_PROXY="$GIT_PROXY" \
      -e http_proxy="$GIT_PROXY" -e https_proxy="$GIT_PROXY" -e all_proxy="$GIT_PROXY" \
      -v "$SOURCE_PARENT:/src" "$SOURCE_IMAGE" \
      clone --depth 1 https://github.com/xbugs221/ozw.git /src/ozw
    return
  fi

  "$DOCKER" run --rm \
    -e HTTP_PROXY="$GIT_PROXY" -e HTTPS_PROXY="$GIT_PROXY" -e ALL_PROXY="$GIT_PROXY" \
    -e http_proxy="$GIT_PROXY" -e https_proxy="$GIT_PROXY" -e all_proxy="$GIT_PROXY" \
    -v "$SOURCE_DIR:/repo" "$SOURCE_IMAGE" \
    -c safe.directory=/repo -C /repo fetch --depth 1 origin main
  "$DOCKER" run --rm \
    -v "$SOURCE_DIR:/repo" "$SOURCE_IMAGE" \
    -c safe.directory=/repo -C /repo merge --ff-only origin/main
}

check_secrets() {
  # Refuse to rebuild if either instance still uses the placeholder template.
  for env_file in "$STACK_DIR/.env.zzl" "$STACK_DIR/.env.dmh"; do
    if [ ! -s "$env_file" ] || grep -q 'replace-with-a-random' "$env_file"; then
      echo "Missing or placeholder secrets: $env_file" >&2
      exit 1
    fi
  done
}

deploy_stack() {
  # Build once from the synchronized checkout, then restart both services.
  "$COMPOSE" -f "$STACK_DIR/compose.yml" build
  "$COMPOSE" -f "$STACK_DIR/compose.yml" up -d --force-recreate
}

ensure_directories
sync_source
check_secrets
deploy_stack
"$COMPOSE" -f "$STACK_DIR/compose.yml" ps
