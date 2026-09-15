#!/usr/bin/env bash
set -euo pipefail

event_name="${1:-}"
action="${2:-}"
before="${3:-}"
after="${4:-}"
pr_base="${5:-}"

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
if [[ ! "$after" =~ $sha_re ]]; then
  emit true "missing or invalid synchronize after SHA"
fi
if ! git cat-file -e "${after}^{commit}" 2>/dev/null; then
  emit true "synchronize after commit is unavailable locally"
fi

# A PR can receive a proof-sensitive commit and then immediately receive a docs
# or runtime-adapter commit. GitHub concurrency cancels the first heavy run.
# Comparing only before..after would then skip the replacement run and leave the
# published snapshot stale. Prefer the PR base..head range so every synchronize
# event remains heavy while the PR still contains any proof-sensitive change.
range_start="$before"
range_reason="synchronize before/head"
if [[ "$pr_base" =~ $sha_re ]]; then
  if ! git cat-file -e "${pr_base}^{commit}" 2>/dev/null; then
    emit true "pull-request base commit is unavailable locally"
  fi
  range_start="$pr_base"
  range_reason="pull-request base/head"
elif [[ ! "$before" =~ $sha_re ]]; then
  emit true "missing or invalid synchronize before SHA"
elif ! git cat-file -e "${before}^{commit}" 2>/dev/null; then
  emit true "synchronize before commit is unavailable locally"
fi

if ! changed="$(git diff --name-only --no-renames "$range_start" "$after")"; then
  emit true "unable to diff $range_reason range"
fi
printf '%s\n' "$changed" >&2

if printf '%s\n' "$changed" | grep -Eq '^(apps/world-viewer/|tools/preview/|engine/compiler/|engine/streaming/|engine/schemas/|requirements-dev\.txt$|package\.json$|package-lock\.json$|\.github/workflows/preview1-realdata-publish\.yml$)'; then
  emit true "proof-sensitive path changed in $range_reason range"
fi

emit false "$range_reason range contains no proof-sensitive path"
