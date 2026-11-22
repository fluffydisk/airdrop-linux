#!/usr/bin/env bash
# The Pages deployment service can lag behind a completed artifact upload.
set -euo pipefail
artifact_id=${1:?Expected an uploaded artifact ID}
[[ "$artifact_id" =~ ^[0-9]+$ ]]
for attempt in {1..12}; do
  if gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id" |
    jq -e --argjson id "$artifact_id" --argjson run "$GITHUB_RUN_ID" '
      .id == $id and .name == "github-pages" and .expired == false and
      .size_in_bytes > 0 and .workflow_run.id == $run' >/dev/null; then
    # Pages uses the Actions Results service, which may still be indexing.
    sleep 10
    exit 0
  fi
  sleep 5
done
echo '::error::Pages did not expose the artifact from this run in time.'
exit 1
