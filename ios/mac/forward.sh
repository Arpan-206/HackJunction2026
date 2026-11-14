#!/usr/bin/env bash
# Forward the iPhone's GeppettoDepth port to this Mac over the USB cable (no WiFi).
# After this, read the phone at 127.0.0.1:${LOCAL_PORT}.
#
#   ios/mac/forward.sh              # local 7700 -> phone 7700
#   LOCAL_PORT=7701 ios/mac/forward.sh
#   UDID=<device id> ios/mac/forward.sh   # when more than one device is plugged in
#
# Needs iproxy and idevice_id from libimobiledevice: brew install libimobiledevice
set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-7700}"
DEVICE_PORT="${DEVICE_PORT:-7700}"

if ! command -v iproxy >/dev/null 2>&1; then
  echo "iproxy is missing. Install it with: brew install libimobiledevice" >&2
  exit 1
fi

devices="$(idevice_id -l 2>/dev/null || true)"
if [ -z "$devices" ]; then
  echo "No iPhone on USB. Plug it in, unlock it and tap Trust on the phone, then run this again." >&2
  echo "(Waiting anyway: iproxy connects as soon as a device appears.)" >&2
else
  echo "USB devices: $devices"
fi

args=()
if [ -n "${UDID:-}" ]; then
  args+=(-u "$UDID")
fi

echo "Forwarding 127.0.0.1:${LOCAL_PORT} -> phone:${DEVICE_PORT}. Leave this running. Ctrl-C stops it."
exec iproxy "${args[@]+"${args[@]}"}" "${LOCAL_PORT}:${DEVICE_PORT}"
