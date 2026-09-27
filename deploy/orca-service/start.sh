#!/usr/bin/env bash
# Starts `orca serve` behind a virtual display. Railway provides PORT and RAILWAY_PUBLIC_DOMAIN.
set -euo pipefail

if [ "$(id -u)" = 0 ]; then
  chown orca:orca /data
  exec setpriv --reuid orca --regid orca --init-groups --reset-env env HOME=/data ORCA_USER_DATA_PATH="$ORCA_USER_DATA_PATH" ELECTRON_DISABLE_SANDBOX=1 \
    PORT="${PORT:-}" RAILWAY_PUBLIC_DOMAIN="${RAILWAY_PUBLIC_DOMAIN:-}" ORCA_PAIRING_ADDRESS="${ORCA_PAIRING_ADDRESS:-}" "$0"
fi

ROOT=/data/workspace
mkdir -p "$ROOT" "$ORCA_USER_DATA_PATH"
[ -d "$ROOT/.git" ] || git -C "$ROOT" init -q -b main

ADDRESS="${ORCA_PAIRING_ADDRESS:-wss://${RAILWAY_PUBLIC_DOMAIN:?set ORCA_PAIRING_ADDRESS or generate a Railway domain}}"
echo "orca serve on :${PORT:-6768}, advertised as ${ADDRESS}"
# Not xvfb-run: as PID 1 it waits forever for Xvfb's ready signal. Start the display ourselves.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
export DISPLAY=:99
exec orca-ide serve --port "${PORT:-6768}" --project-root "$ROOT" --pairing-address "$ADDRESS"
