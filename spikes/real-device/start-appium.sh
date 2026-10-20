#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export APPIUM_HOME="$WORKSPACE_ROOT/.appium"
export APPIUM_XCUITEST_PREFER_DEVICECTL=1

exec "$WORKSPACE_ROOT/node_modules/.bin/appium" \
  --address "${UXR_APPIUM_HOST:-127.0.0.1}" \
  --port "${UXR_APPIUM_PORT:-4723}" \
  --log-timestamp \
  --log-no-colors

