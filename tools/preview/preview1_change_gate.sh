#!/usr/bin/env bash
set -euo pipefail

event_name="${1:-}"
action="${2:-}"
before="${3:-}"
after="${4:-}"

emit() {
  printf 'heavy=%s\n' "$1"
  printf 'reason=%s\n' "$2" >&2
  exit 0
}

if [[ "$event_name" != "pull_request" ]]; then
  emit true "non-pull-request event"
fi

case "$action" in
  opened|reopened)
    emit true "pull request opened or reopened"
    ;;
  synchronize)
    ;;
  *)
    emit true "unrecognized pull_request action: ${action:-missing}"
    ;;
esac

sha_re='^[0-9a-fA-F]{40}$'
if [[ ! "$before" =~ $sha_re || ! "$after" =~ $sha_re ]]; then
  emit true "missing or invalid synchronize before/after SHA"
fi
if ! git cat-file -e "${before}^{commit}" 2>/dev/null || ! git cat-file -e "${after}^{commit}" 2>/dev/null; then
  emit true "synchronize range is unavailable locally"
fi

if ! changed="$(git diff --name-only --no-renames "$before" "$after")"; then
  emit true "unable to diff synchronize range"
fi
printf '%s\n' "$changed" >&2
if printf '%s\n' "$changed" | grep -Eq '^(apps/world-viewer/|tools/preview/|\.github/workflows/preview1-realdata-publish\.yml$)'; then
  emit true "proof-sensitive path changed in synchronize range"
fi
emit false "synchronize range contains no proof-sensitive path"
