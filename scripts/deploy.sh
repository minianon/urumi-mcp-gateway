#!/usr/bin/env bash
# Deploy (or upgrade) all three releases to the current kubectl context with an environment's
# values. Used for the VPS; local-up.sh does the same for k3d plus building images.
#
#   REGISTRY=ghcr.io/<owner> TAG=1.0.0 scripts/deploy.sh prod
#
# Expects deploy/secrets/<env>/{store,supplier,platform}.yaml (scripts/gen-secrets.sh <env>).
set -euo pipefail

ENV_NAME="${1:?usage: deploy.sh <env>}"
: "${REGISTRY:?set REGISTRY, e.g. ghcr.io/<owner>}"
: "${TAG:?set TAG, e.g. 1.0.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
S="$ROOT/deploy/secrets/$ENV_NAME"
cd "$ROOT"
[[ -f "$S/platform.yaml" ]] || { echo "missing $S/*.yaml - run scripts/gen-secrets.sh $ENV_NAME"; exit 1; }

echo "Deploying $ENV_NAME to context $(kubectl config current-context) with images $REGISTRY/urumi-*:$TAG"

for ns in store-main mcp-tools urumi; do
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl label namespace "$ns" --overwrite \
    pod-security.kubernetes.io/enforce=restricted pod-security.kubernetes.io/warn=restricted >/dev/null
done

helm upgrade --install store charts/store -n store-main \
  -f "charts/store/values-$ENV_NAME.yaml" -f "$S/store.yaml" \
  --set mcp.image.repository="$REGISTRY/urumi-woo-mcp" --set mcp.image.tag="$TAG" \
  --wait --timeout 15m

helm upgrade --install supplier charts/mcp-server -n mcp-tools \
  -f "charts/mcp-server/values-$ENV_NAME.yaml" -f "$S/supplier.yaml" \
  --set image.repository="$REGISTRY/urumi-supplier-mcp" --set image.tag="$TAG" \
  --wait --timeout 5m

helm upgrade --install platform charts/platform -n urumi \
  -f "charts/platform/values-$ENV_NAME.yaml" -f "$S/platform.yaml" \
  --set gateway.image.repository="$REGISTRY/urumi-gateway" --set gateway.image.tag="$TAG" \
  --set dashboard.image.repository="$REGISTRY/urumi-dashboard" --set dashboard.image.tag="$TAG" \
  --wait --timeout 10m

helm list -A
