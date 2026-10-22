#!/usr/bin/env bash
# One command from zero to a working local stack on k3d.
#
#   scripts/local-up.sh                 # create cluster (if needed), build, deploy everything
#   ONLY=platform scripts/local-up.sh   # rebuild + redeploy just one release (store|supplier|platform)
#   SKIP_BUILD=1 scripts/local-up.sh    # redeploy with the last built images
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLUSTER="${CLUSTER:-urumi}"
ONLY="${ONLY:-all}"
cd "$ROOT"

for bin in docker k3d kubectl helm openssl; do
  command -v "$bin" >/dev/null || { echo "missing dependency: $bin"; exit 1; }
done

# --- cluster ---------------------------------------------------------------------------------
if ! k3d cluster get "$CLUSTER" >/dev/null 2>&1; then
  echo "==> creating k3d cluster '$CLUSTER' (ports 80/443 -> Traefik ingress)"
  k3d cluster create "$CLUSTER" --agents 0 -p "80:80@loadbalancer" -p "443:443@loadbalancer" --wait
fi
kubectl config use-context "k3d-$CLUSTER" >/dev/null

scripts/gen-secrets.sh local

# --- images ----------------------------------------------------------------------------------
TAG_FILE="$ROOT/deploy/.last-image-tag"
if [[ "${SKIP_BUILD:-0}" == "1" && -f "$TAG_FILE" ]]; then
  TAG="$(cat "$TAG_FILE")"
else
  TAG="dev-$(date +%Y%m%d%H%M%S)"
  case "$ONLY" in
    store) images=(woo-mcp) ;;
    supplier) images=(supplier-mcp) ;;
    platform) images=(gateway dashboard) ;;
    *) images=(woo-mcp supplier-mcp gateway dashboard) ;;
  esac
  for img in "${images[@]}"; do
    echo "==> building urumi/$img:$TAG"
    docker build -q -t "urumi/$img:$TAG" "services/$img" >/dev/null
  done
  echo "==> importing images into k3d"
  k3d image import -c "$CLUSTER" $(printf "urumi/%s:$TAG " "${images[@]}") >/dev/null
  echo "$TAG" > "$TAG_FILE"
fi

# --- namespaces: restricted Pod Security Standard everywhere ----------------------------------
for ns in store-main mcp-tools urumi; do
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl label namespace "$ns" --overwrite \
    pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/warn=restricted >/dev/null
done

S="deploy/secrets/local"
if [[ "$ONLY" == all || "$ONLY" == store ]]; then
  echo "==> store (WordPress + WooCommerce + MariaDB + woo MCP) -> namespace store-main"
  helm upgrade --install store charts/store -n store-main \
    -f charts/store/values-local.yaml -f "$S/store.yaml" \
    --set mcp.image.tag="$TAG" --wait --timeout 15m
fi
if [[ "$ONLY" == all || "$ONLY" == supplier ]]; then
  echo "==> supplier MCP server -> namespace mcp-tools"
  helm upgrade --install supplier charts/mcp-server -n mcp-tools \
    -f charts/mcp-server/values-local.yaml -f "$S/supplier.yaml" \
    --set image.tag="$TAG" --wait --timeout 5m
fi
if [[ "$ONLY" == all || "$ONLY" == platform ]]; then
  echo "==> platform (gateway + dashboard + postgres) -> namespace urumi"
  helm upgrade --install platform charts/platform -n urumi \
    -f charts/platform/values-local.yaml -f "$S/platform.yaml" \
    --set gateway.image.tag="$TAG" --set dashboard.image.tag="$TAG" --wait --timeout 10m
fi

ADMIN_PW="$(grep adminPassword "$S/platform.yaml" | sed -E 's/.*"(.*)"/\1/')"
cat <<EOF

Ready.
  Storefront:   http://store.127.0.0.1.nip.io
  WP admin:     http://store.127.0.0.1.nip.io/wp-admin   (user: admin, password: deploy/secrets/local/store.yaml wpAdminPassword)
  Dashboard:    http://app.127.0.0.1.nip.io              (admin@urumi.local / $ADMIN_PW)
  MCP endpoint: http://app.127.0.0.1.nip.io/mcp          (Authorization: Bearer <your API key>)
EOF
