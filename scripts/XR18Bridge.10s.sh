#!/usr/bin/env bash
# <swiftbar.title>XR18 Bridge</swiftbar.title>
# <swiftbar.refresh>10</swiftbar.refresh>

PLUGIN_DIR="/Users/razielpanic/Library/Application Support/HotSpot/StreamDock/plugins/com.youshriek.xr18fx.sdPlugin"
LOG_FILE="$HOME/Library/Logs/xrDock-bridge.log"

is_running() {
  pgrep -f "node .*xrDock-bridge.js" >/dev/null 2>&1
}

if [[ "$1" == "start" ]]; then
  if ! is_running; then
    # Ensure log directory exists and truncate log on each start
    mkdir -p "$(dirname "$LOG_FILE")"
    : >"$LOG_FILE"
    cd "$PLUGIN_DIR" || exit 0
    "/opt/homebrew/bin/node" xrDock-bridge.js >>"$LOG_FILE" 2>&1 &
  fi
  exit 0
fi

if [[ "$1" == "stop" ]]; then
  pkill -f "node .*xrDock-bridge.js" >/dev/null 2>&1
  exit 0
fi

# Menu output
if is_running; then
  echo "XR●18"
  echo "---"
  echo "Stop bridge | bash='$0' param1=stop refresh=true terminal=false"
else
  echo "XR○18"
  echo "---"
  echo "Start bridge | bash='$0' param1=start refresh=true terminal=false"
fi

echo "Open log | bash='/usr/bin/open' param1='$LOG_FILE' terminal=false"
