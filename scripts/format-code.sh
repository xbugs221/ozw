#!/usr/bin/env bash
# PURPOSE: Apply the repository's conservative text formatting rules.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

mode="write"
scope="all"
for arg in "$@"; do
  case "$arg" in
    --check)
      mode="check"
      ;;
    --staged)
      scope="staged"
      ;;
    --all)
      scope="all"
      ;;
    *)
      echo "Unknown format option: $arg" >&2
      exit 2
      ;;
  esac
done

collect_target_files() {
  # PURPOSE: Select source-like tracked files while avoiding generated output.
  if [[ "$scope" == "staged" ]]; then
    git diff --cached --name-only --diff-filter=ACMR -z --
  else
    git ls-files -z --
  fi
}

is_formattable_file() {
  # PURPOSE: Keep formatting scoped to text files where whitespace cleanup is safe.
  local file_path="$1"
  case "$file_path" in
    node_modules/*|dist/*|dist-node/*|coverage/*|tests/test-results/*|playwright-report/*|authdb/*|logs/*|*.db|*.sqlite|*.sqlite3)
      return 1
      ;;
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.css|*.html|*.yml|*.yaml|*.sh)
      [[ -f "$file_path" ]]
      ;;
    *)
      return 1
      ;;
  esac
}

format_file() {
  # PURPOSE: Remove trailing whitespace and ensure a final newline without changing code layout.
  local file_path="$1"
  local tmp_file
  tmp_file="$(mktemp)"
  perl -0pe 's/[ \t]+(\r?\n)/$1/g; s/\s*\z/\n/s' "$file_path" > "$tmp_file"
  if ! cmp -s "$file_path" "$tmp_file"; then
    if [[ "$mode" == "check" ]]; then
      rm -f "$tmp_file"
      printf '%s\n' "$file_path"
      return 2
    fi
    chmod --reference="$file_path" "$tmp_file"
    mv "$tmp_file" "$file_path"
    return 1
  fi
  rm -f "$tmp_file"
  return 0
}

changed=0
failed=0
while IFS= read -r -d '' file_path; do
  if ! is_formattable_file "$file_path"; then
    continue
  fi
  status=0
  format_file "$file_path" || status=$?
  if [[ "$status" -eq 1 ]]; then
    changed=1
  elif [[ "$status" -eq 2 ]]; then
    failed=1
  fi
done < <(collect_target_files)

if [[ "$mode" == "check" && "$failed" -ne 0 ]]; then
  echo "[format] Files need whitespace formatting."
  exit 1
fi

if [[ "$changed" -ne 0 ]]; then
  echo "[format] Applied whitespace formatting."
else
  echo "[format] No formatting changes needed."
fi
