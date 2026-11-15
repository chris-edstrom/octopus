#!/usr/bin/env bash
# Runs apps/web/lib/__tests__/gitea-live.test.ts against a disposable Gitea.
#
# The test drives the real Forgejo client and webhook route over the network, so
# it needs what a real self-hosted install needs: Gitea on HTTPS at a private,
# non-loopback address (Octopus refuses loopback Forgejo hosts), a CA the runtime
# trusts, and a route from Gitea back to this machine for webhook deliveries.
#
#   scripts/gitea-live-test.sh
#
# Overrides:
#   CONTAINER_RUNTIME       docker or podman (default: whichever is installed)
#   GITEA_IMAGE             default docker.io/gitea/gitea:latest
#   GITEA_LIVE_ADDRESS      address this machine uses to reach the container
#   GITEA_LIVE_HOOK_ADDRESS address the container uses to reach this machine
#   GITEA_LIVE_RELAY=1      relay deliveries through node; for hosts whose firewall
#                           blocks inbound connections to bun (Windows default)
#   GITEA_LIVE_KEEP=1       leave the container running afterwards
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash would rewrite the container-side /data paths.

runtime="${CONTAINER_RUNTIME:-$(command -v docker >/dev/null 2>&1 && echo docker || echo podman)}"
image="${GITEA_IMAGE:-docker.io/gitea/gitea:latest}"
name="octopus-gitea-live"
port=3443
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
# Native Windows tools need a Windows path once path rewriting is off.
command -v cygpath >/dev/null 2>&1 && work="$(cygpath -m "$work")"

if [ -z "${GITEA_LIVE_ADDRESS:-}" ] || [ -z "${GITEA_LIVE_HOOK_ADDRESS:-}" ]; then
  if [ "$runtime" = podman ] && podman machine inspect >/dev/null 2>&1; then
    # podman machine: the VM publishes the port; its default gateway is this host.
    : "${GITEA_LIVE_ADDRESS:=$(podman machine ssh "ip -4 -o addr show eth0" | awk '{print $4}' | cut -d/ -f1 | tail -1)}"
    : "${GITEA_LIVE_HOOK_ADDRESS:=$(podman machine ssh "ip route show default" | awk '{print $3}' | tail -1)}"
  else
    # Native engine: the bridge gateway is this host from both sides.
    gateway="$("$runtime" network inspect bridge -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || true)"
    : "${GITEA_LIVE_ADDRESS:=$gateway}"
    : "${GITEA_LIVE_HOOK_ADDRESS:=$gateway}"
  fi
fi
[ -n "$GITEA_LIVE_ADDRESS" ] && [ -n "$GITEA_LIVE_HOOK_ADDRESS" ] || {
  echo "Could not detect addresses; set GITEA_LIVE_ADDRESS and GITEA_LIVE_HOOK_ADDRESS." >&2; exit 1; }

relay_pid=""
cleanup() {
  [ -n "$relay_pid" ] && kill "$relay_pid" 2>/dev/null || true
  if [ -z "${GITEA_LIVE_KEEP:-}" ]; then
    "$runtime" rm -f "$name" >/dev/null 2>&1 || true
    "$runtime" volume rm -f "$name" >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

"$runtime" rm -f "$name" >/dev/null 2>&1 || true
"$runtime" volume rm -f "$name" >/dev/null 2>&1 || true
# A self-signed CA certificate for the address the test connects to.
"$runtime" run --rm -v "$name:/data" --entrypoint sh "$image" -c \
  "cd /data && gitea cert --host '$GITEA_LIVE_ADDRESS' --ca >/dev/null 2>&1 && chown 1000:1000 cert.pem key.pem"
"$runtime" run -d --name "$name" -p "$port:$port" -v "$name:/data" \
  -e GITEA__security__INSTALL_LOCK=true \
  -e GITEA__database__DB_TYPE=sqlite3 \
  -e GITEA__server__PROTOCOL=https \
  -e GITEA__server__HTTP_PORT="$port" \
  -e GITEA__server__DOMAIN="$GITEA_LIVE_ADDRESS" \
  -e GITEA__server__ROOT_URL="https://$GITEA_LIVE_ADDRESS:$port/" \
  -e GITEA__server__CERT_FILE=/data/cert.pem \
  -e GITEA__server__KEY_FILE=/data/key.pem \
  -e GITEA__security__ALLOWED_HOST_LIST="$GITEA_LIVE_HOOK_ADDRESS" \
  -e GITEA__webhook__ALLOWED_HOST_LIST="$GITEA_LIVE_HOOK_ADDRESS" \
  -e GITEA__log__LEVEL=Warn \
  "$image" >/dev/null

"$runtime" cp "$name:/data/cert.pem" "$work/ca.pem"
url="https://$GITEA_LIVE_ADDRESS:$port"
for _ in $(seq 1 60); do
  curl -fs --cacert "$work/ca.pem" -m 3 "$url/api/v1/version" >/dev/null && break
  sleep 1
done
curl -fs --cacert "$work/ca.pem" -m 3 "$url/api/v1/version" >/dev/null || { echo "Gitea did not start at $url" >&2; "$runtime" logs --tail 20 "$name" >&2; exit 1; }

"$runtime" exec -u git "$name" gitea admin user create --username octopus-live --email octopus-live@example.com \
  --random-password --admin --must-change-password=false >/dev/null
token="$("$runtime" exec -u git "$name" gitea admin user generate-access-token --username octopus-live \
  --token-name live-test --scopes all --raw | tail -1)"

hook_port=39911
hook_origin="http://$GITEA_LIVE_HOOK_ADDRESS:$hook_port"
if [ -n "${GITEA_LIVE_RELAY:-}" ]; then
  relay_port=39910
  node -e "const net=require('net');net.createServer(c=>{const u=net.connect($hook_port,'127.0.0.1');c.pipe(u).pipe(c);c.on('error',()=>{});u.on('error',()=>c.destroy());}).listen($relay_port,'0.0.0.0')" &
  relay_pid=$!
  hook_origin="http://$GITEA_LIVE_HOOK_ADDRESS:$relay_port"
fi

cd "$root/apps/web"
GITEA_LIVE_URL="$url" GITEA_LIVE_TOKEN="$token" \
GITEA_LIVE_HOOK_ORIGIN="$hook_origin" GITEA_LIVE_HOOK_PORT="$hook_port" \
NODE_EXTRA_CA_CERTS="$work/ca.pem" \
  bun test lib/__tests__/gitea-live.test.ts
