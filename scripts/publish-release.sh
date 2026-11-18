#!/usr/bin/env bash
# Uploads the given files to the GitHub release for this version, creating the
# release (and its tag) if needed. The Mac and Windows jobs both run this, in
# either order, so a lost race to create the release is fine.
set -euo pipefail

if [ "${GITHUB_REF_TYPE:-}" = tag ]; then
  TAG="$GITHUB_REF_NAME"
else
  TAG="v$(node -p "require('./package.json').version")"
fi

if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --target "$GITHUB_SHA" --title "$TAG" --generate-notes ||
    gh release view "$TAG" >/dev/null
fi
gh release upload "$TAG" "$@" --clobber
