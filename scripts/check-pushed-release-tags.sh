#!/usr/bin/env bash
# PURPOSE: Prevent release tags whose package.json version does not match the tag.
set -euo pipefail

while read -r local_ref local_sha _remote_ref _remote_sha; do
  # PURPOSE: Ignore branch pushes, tag deletions, and non-release tags.
  [[ "$local_ref" =~ ^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
  [[ "$local_sha" != 0000000000000000000000000000000000000000 ]] || continue

  commit_sha="$(git rev-parse "${local_ref}^{commit}")"
  package_version="$(git show "${commit_sha}:package.json" | node --input-type=module -e '
    let input = "";
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => process.stdout.write(JSON.parse(input).version));
  ')"
  tag_name="${local_ref#refs/tags/}"

  if [[ "$tag_name" != "v${package_version}" ]]; then
    echo "拒绝推送：${tag_name} 指向的 package.json 版本是 ${package_version}。" >&2
    echo "请使用：pnpm run release -- ${tag_name#v}" >&2
    exit 1
  fi
done
