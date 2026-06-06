#!/usr/bin/env bash
# PhotoTrol face-embed sidecar — one-shot Ubuntu installer (DigitalOcean, etc.)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOU/phototrol-face-embed/main/install-ubuntu.sh | bash
#   curl -fsSL ... | SIDECAR_GIT_URL=https://github.com/YOU/phototrol-face-embed.git bash
#
# Installs Node 20, cloudflared, canvas build deps, sidecar, models, starts sidecar + tunnel.
# Prints SetEnv lines for HostGator phototrol.com/.htaccess

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/face-embed}"
PORT="${FACE_EMBED_PORT:-8723}"
KEY_FILE="${KEY_FILE:-/root/.face-embed-key}"
LOG_DIR="${LOG_DIR:-/var/log/face-embed}"
SIDECAR_GIT_URL="${SIDECAR_GIT_URL:-}"
SIDECAR_RELEASE_URL="${SIDECAR_RELEASE_URL:-}"

export DEBIAN_FRONTEND=noninteractive

log() { echo "[face-embed-install] $*"; }
need_root() { [ "$(id -u)" -eq 0 ] || { echo "Run as root (DO web console is root by default)"; exit 1; }; }

need_root
mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

log "Installing system packages..."
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg build-essential python3 \
  pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  git openssl

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | tr -d v | cut -d. -f1)" -lt 18 ]; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  log "Installing cloudflared..."
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
fi

log "Fetching sidecar source into $INSTALL_DIR ..."
mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -n "$SIDECAR_GIT_URL" ]; then
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$SIDECAR_GIT_URL" "$INSTALL_DIR"
elif [ -n "$SIDECAR_RELEASE_URL" ]; then
  rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  curl -fsSL "$SIDECAR_RELEASE_URL" | tar -xzf - -C "$INSTALL_DIR" --strip-components=1
elif [ -f "$(dirname "${BASH_SOURCE[0]:-$0}")/server.js" ]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
  rm -rf "$INSTALL_DIR"
  cp -a "$SRC" "$INSTALL_DIR"
elif [ -f "./server.js" ]; then
  rm -rf "$INSTALL_DIR"
  cp -a "$(pwd)" "$INSTALL_DIR"
else
  echo "!! No sidecar source. Set SIDECAR_GIT_URL or SIDECAR_RELEASE_URL, or run from sidecar directory."
  exit 1
fi

cd "$INSTALL_DIR"

log "npm install (may take 2–4 min on first run)..."
npm install --omit=dev

log "Fetching face-api models..."
npm run fetch-models

[ -s "$KEY_FILE" ] || openssl rand -hex 32 > "$KEY_FILE"
chmod 600 "$KEY_FILE"
export FACE_EMBED_SHARED_KEY="$(cat "$KEY_FILE")"
export FACE_EMBED_BIND=127.0.0.1
export FACE_EMBED_PORT="$PORT"

pkill -f "node server.js" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
sleep 1

log "Starting sidecar on 127.0.0.1:$PORT ..."
nohup npm start >"$LOG_DIR/sidecar.log" 2>&1 &
for i in $(seq 1 60); do
  if curl -sf -H "x-embed-key: $FACE_EMBED_SHARED_KEY" "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
HEALTH=$(curl -s -H "x-embed-key: $FACE_EMBED_SHARED_KEY" "http://127.0.0.1:$PORT/healthz" || echo '{"ok":false}')

log "Starting cloudflared tunnel..."
: >"$LOG_DIR/tunnel.log"
nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" >"$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_URL=""
for i in $(seq 1 60); do
  TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)
  [ -n "$TUNNEL_URL" ] && break
  sleep 1
done

PUBLIC_IP=$(curl -s --max-time 8 ifconfig.me 2>/dev/null || curl -s --max-time 8 api.ipify.org 2>/dev/null || echo "unknown")

cat <<EOF

================================================================================
 PhotoTrol face-embed — READY
================================================================================
VPS public IP   : $PUBLIC_IP
Sidecar health  : $HEALTH
Tunnel URL      : ${TUNNEL_URL:-NOT READY — tail -f $LOG_DIR/tunnel.log}
Key file        : $KEY_FILE  (chmod 600)

--- Paste into HostGator /home5/hertz2p/phototrol.com/.htaccess ---
SetEnv FACE_EMBED_URL ${TUNNEL_URL:-https://REPLACE-WHEN-TUNNEL-READY}
SetEnv FACE_EMBED_SHARED_KEY $(cat "$KEY_FILE")

--- Smoke test (HostGator jailshell, after SetEnv) ---
curl -s 'https://phototrol.com/cron/face_embed_backfill.php?key=YOUR_PHT_CRON_KEY&batch=1'

Logs: $LOG_DIR/sidecar.log  $LOG_DIR/tunnel.log
Restart after reboot: cd $INSTALL_DIR && FACE_EMBED_SHARED_KEY=\$(cat $KEY_FILE) nohup npm start &
================================================================================
EOF
