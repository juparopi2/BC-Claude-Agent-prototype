#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# dev-tunnel.sh — Expose local backend via Microsoft Dev Tunnels for webhook testing
#
# Usage: npm run dev:tunnel
#
# Flow:
#   1. Verify devtunnel login (opens browser if needed)
#   2. Create or reuse named tunnel (persistent across restarts)
#   3. Forward port 3002 with HTTPS + anonymous access
#   4. Extract public URL and update .env
#   5. Host tunnel in background
#   6. Start backend (nodemon) in foreground
#   7. Cleanup tunnel on exit (Ctrl+C)
#
# Why --allow-anonymous:
#   Microsoft Graph sends raw HTTP POSTs to webhook URLs. It cannot
#   authenticate with Entra ID. Security is enforced at the app layer
#   via clientState validation (see webhooks.ts). This matches production
#   behavior where the endpoint is also publicly accessible.
# ============================================================================

TUNNEL_NAME="myworkmate-dev"
BACKEND_PORT=3002
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Detect WSL vs Git Bash once, used throughout
IS_WSL=false
if grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=true
fi

# ---------- 0. Locate devtunnel ----------
# npm on Windows may invoke WSL bash (HOME=/home/...) or Git Bash (HOME=/c/Users/...).
# Detect environment and resolve the Windows user profile accordingly.
if grep -qi microsoft /proc/version 2>/dev/null; then
  # WSL: Windows paths are under /mnt/c/, executables need .exe suffix
  WIN_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r')
  WIN_HOME="/mnt/c/Users/$WIN_USER"
  EXE_SUFFIX=".exe"
else
  # Git Bash / MSYS2: paths use /c/ format
  WIN_HOME="${HOME:-}"
  # Fallback: convert USERPROFILE (C:\Users\x) to /c/Users/x
  if [[ -z "$WIN_HOME" || "$WIN_HOME" == /home/* ]]; then
    UP="${USERPROFILE:-}"
    UP="${UP//\\//}"
    if [[ "$UP" =~ ^([A-Za-z]): ]]; then
      WIN_HOME="/${BASH_REMATCH[1],,}${UP:2}"
    fi
  fi
  EXE_SUFFIX=""
fi

find_devtunnel() {
  # 1. Already on PATH (with or without .exe)
  command -v "devtunnel${EXE_SUFFIX}" 2>/dev/null && return 0
  command -v devtunnel 2>/dev/null && return 0
  # 2. WinGet links directory
  local winget="$WIN_HOME/AppData/Local/Microsoft/WinGet/Links"
  for f in "$winget/devtunnel${EXE_SUFFIX}" "$winget/devtunnel.exe" "$winget/devtunnel"; do
    [ -e "$f" ] && echo "$f" && return 0
  done
  return 1
}

DEVTUNNEL=$(find_devtunnel) || {
  echo "ERROR: devtunnel not found."
  echo "  WIN_HOME=$WIN_HOME"
  echo "  Install with: winget install Microsoft.devtunnel"
  exit 1
}
echo "    Using: $DEVTUNNEL"

# ---------- 1. Verify login ----------
echo "==> Checking devtunnel login..."
LOGIN_OUTPUT=$("$DEVTUNNEL" user show 2>&1 || true)
if echo "$LOGIN_OUTPUT" | grep -qi "not logged in"; then
  echo "    Not logged in. Opening browser for authentication..."
  "$DEVTUNNEL" user login
  LOGIN_OUTPUT=$("$DEVTUNNEL" user show 2>&1 || true)
fi
LOGIN_INFO=$(echo "$LOGIN_OUTPUT" | grep "Logged in" || echo "unknown")
echo "    $LOGIN_INFO"

# ---------- 2. Create or reuse named tunnel ----------
echo ""
echo "==> Setting up tunnel '$TUNNEL_NAME'..."
if ! "$DEVTUNNEL" show "$TUNNEL_NAME" &>/dev/null 2>&1; then
  echo "    Creating new tunnel..."
  "$DEVTUNNEL" create "$TUNNEL_NAME" --allow-anonymous
else
  echo "    Reusing existing tunnel"
fi

# ---------- 3. Ensure port is configured ----------
echo "    Adding port $BACKEND_PORT (ignored if already exists)..."
"$DEVTUNNEL" port create "$TUNNEL_NAME" -p "$BACKEND_PORT" --protocol http 2>/dev/null || true

# ---------- 4. Extract the public URL ----------
echo ""
echo "==> Resolving tunnel URL..."
# The tunnel ID includes a region suffix (e.g. "myworkmate-dev.use2").
# The public URL pattern is: https://<tunnelId>-<port>.<region>.devtunnels.ms
TUNNEL_ID=$("$DEVTUNNEL" show "$TUNNEL_NAME" --json 2>/dev/null \
  | grep -o '"tunnelId"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | grep -o '"[^"]*"$' \
  | tr -d '"')

if [ -z "$TUNNEL_ID" ]; then
  echo "    ERROR: Could not extract tunnel ID. Run '$DEVTUNNEL show $TUNNEL_NAME --json' manually."
  exit 1
fi

# Split "myworkmate-dev.use2" -> name="myworkmate-dev" region="use2"
TUNNEL_REGION="${TUNNEL_ID##*.}"
TUNNEL_BASE="${TUNNEL_ID%.*}"
TUNNEL_URL="https://${TUNNEL_BASE}-${BACKEND_PORT}.${TUNNEL_REGION}.devtunnels.ms"
echo "    Tunnel URL: $TUNNEL_URL"

# ---------- 5. Update .env ----------
echo ""
echo "==> Updating .env..."
# In WSL, ENV_FILE is on the Windows FS (/mnt/d/...) — sed -i works fine on it.
if grep -q "^GRAPH_WEBHOOK_BASE_URL=" "$ENV_FILE" 2>/dev/null; then
  # Use a temp file approach (portable across sed implementations)
  sed "s|^GRAPH_WEBHOOK_BASE_URL=.*|GRAPH_WEBHOOK_BASE_URL=$TUNNEL_URL|" "$ENV_FILE" > "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "    Replaced GRAPH_WEBHOOK_BASE_URL=$TUNNEL_URL"
else
  echo "GRAPH_WEBHOOK_BASE_URL=$TUNNEL_URL" >> "$ENV_FILE"
  echo "    Appended GRAPH_WEBHOOK_BASE_URL=$TUNNEL_URL"
fi

# ---------- 6. Host tunnel in background ----------
echo ""
echo "==> Starting tunnel host..."
"$DEVTUNNEL" host "$TUNNEL_NAME" > /dev/null 2>&1 &
TUNNEL_PID=$!

cleanup() {
  echo ""
  echo "==> Shutting down tunnel (PID $TUNNEL_PID)..."
  kill "$TUNNEL_PID" 2>/dev/null || true
  wait "$TUNNEL_PID" 2>/dev/null || true
  echo "    Tunnel stopped."
}
trap cleanup EXIT INT TERM

# Give the tunnel a moment to establish
sleep 3

# ---------- 6b. Verify tunnel connectivity ----------
echo "==> Verifying tunnel connectivity..."
for i in 1 2 3 4 5; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$TUNNEL_URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ]; then
    echo "    Tunnel responding (HTTP $HTTP_CODE) after ${i} attempt(s)"
    break
  fi
  if [ "$i" -eq 5 ]; then
    echo "    WARNING: Tunnel not reachable after 5 attempts."
    echo "    Webhooks may fail. Polling fallback will still work."
  fi
  sleep 2
done

# ---------- 7. Start backend ----------
echo "==> Starting backend on port $BACKEND_PORT..."
echo "    Webhook URL: $TUNNEL_URL/api/webhooks/graph"
echo ""
if [ "$IS_WSL" = true ]; then
  # WSL can't run .cmd batch files directly — delegate to cmd.exe
  WIN_DIR=$(wslpath -w "$SCRIPT_DIR/..")
  cmd.exe /c "cd /d $WIN_DIR && npx nodemon --exec tsx src/server.ts"
else
  cd "$SCRIPT_DIR/.."
  npx nodemon --exec tsx src/server.ts
fi
