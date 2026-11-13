#!/usr/bin/env bash
# Sets up this machine to run Paintball online: Node, Caddy (HTTPS) and a service that restarts by itself.
# Usage: sudo [variables] deploy/setup-ubuntu.sh <standalone|matchmaker|node> <domain>
# See "Online and multi-server" in README.md for the variables each role needs.
set -euo pipefail

ROLE="${1:-}"; DOMAIN="${2:-}"
[ -n "$DOMAIN" ] || { echo "Usage: sudo [variables] $0 <standalone|matchmaker|node> <domain>"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Run this with sudo"; exit 1; }
case "$ROLE" in
  standalone) : "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}" ;;
  matchmaker) : "${NODE_SECRET:?set NODE_SECRET}"; : "${ADMIN_PASSWORD:?set ADMIN_PASSWORD}" ;;
  node)       : "${NODE_SECRET:?set NODE_SECRET}"; : "${MATCHMAKER_URL:?set MATCHMAKER_URL}" ;;
  *) echo "Role must be standalone, matchmaker or node"; exit 1 ;;
esac
APP="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "== Game"
id paintball >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin paintball
(cd "$APP" && npm ci --omit=dev)
chown -R paintball:paintball "$APP"

install -m 600 /dev/null /etc/paintball.env
{
  echo "ROLE=$ROLE"
  echo "PORT=8080"
  echo "BIND=127.0.0.1"
  [ -z "${NODE_SECRET:-}" ] || echo "NODE_SECRET=$NODE_SECRET"
  [ -z "${ADMIN_PASSWORD:-}" ] || echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
  if [ "$ROLE" = node ]; then
    echo "MATCHMAKER_URL=$MATCHMAKER_URL"
    echo "PUBLIC_URL=wss://$DOMAIN"
    echo "REGION=${REGION:-default}"
    echo "NODE_ID=${NODE_ID:-$DOMAIN}"
  fi
  [ -z "${MAX_ROOMS:-}" ] || echo "MAX_ROOMS=$MAX_ROOMS"
  [ -z "${WAIT_TIME:-}" ] || echo "WAIT_TIME=$WAIT_TIME"
} > /etc/paintball.env

cat > /etc/systemd/system/paintball.service <<UNIT
[Unit]
Description=Paintball VR ($ROLE)
After=network-online.target
Wants=network-online.target

[Service]
User=paintball
WorkingDirectory=$APP
EnvironmentFile=/etc/paintball.env
ExecStart=$(command -v node) server/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy localhost:8080
}
CADDY

systemctl daemon-reload
systemctl enable --now paintball
systemctl restart paintball
systemctl reload caddy || systemctl restart caddy

echo
echo "Done: $ROLE on https://$DOMAIN"
echo "Logs: journalctl -u paintball -f"
