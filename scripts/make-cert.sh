#!/bin/sh
# Creates a self-signed certificate for this machine's LAN IPs so the Quest
# browser can open the game over HTTPS (WebXR requires a secure context).
set -e
cd "$(dirname "$0")/.."
mkdir -p certs
SAN="DNS:localhost,IP:127.0.0.1"
for ip in $(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}'); do
  SAN="$SAN,IP:$ip"
done
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=paintball-vr-local" \
  -addext "subjectAltName=$SAN" 2>/dev/null
echo "Certificate created in certs/ for: $SAN"
echo "Restart the server, then open https://<your-mac-ip>:8443 on the Quest."
