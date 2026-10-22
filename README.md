# Urumi: WooCommerce hosting with a team MCP gateway on Kubernetes

An admin connects MCP servers once. Every team member then uses all of them through **one MCP
endpoint** (Claude Code, Cursor, MCP Inspector) and through a **chat agent** in the dashboard,
without ever seeing an upstream credential. The first data source is a WooCommerce store running
in the same cluster, exposed by an MCP server I wrote.

```
store-main ns              mcp-tools ns           urumi ns                                   outside
┌──────────────────────┐   ┌──────────────┐   ┌───────────────────────────────────────┐
│ WordPress+WooCommerce│◀──│              │   │ Gateway x2 ── /mcp ◀── Claude Code ───┼── API key
│ MariaDB   setup Job  │   │ supplier-mcp │◀──│   MCP client to every upstream        │
│ woo-mcp (ClusterIP)  │◀──┼──────────────┼───│   MCP server for every user           │
└──────────────────────┘   └──────────────┘   │   chat agent ── Groq (OpenAI API)     │
        ▲ storefront                          │ Dashboard (React)   Postgres          │──▶ mcp.deepwiki.com
        └──────────── Traefik Ingress ────────┴───────────────────────────────────────┘
```

| | |
|---|---|
| **Design & tradeoffs** | [docs/DESIGN.md](docs/DESIGN.md): architecture, tool aggregation, routing, failure handling, local vs prod |
| **Threat model** | [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): shared credentials, no token passthrough, malicious upstreams, member vs member |
| **Demo script** | [docs/DEMO.md](docs/DEMO.md): the definition-of-done flow, step by step |
| **API** | [docs/API.md](docs/API.md): dashboard REST API |

## Repository layout

```
services/
  woo-mcp/        WooCommerce MCP server (TypeScript, MCP SDK, Streamable HTTP, OAuth1-signed REST)
  supplier-mcp/   second upstream: wholesale catalog + FX (also has `list_products`, to show collisions)
  gateway/        dashboard API + aggregated MCP endpoint + upstream MCP client + chat agent
  dashboard/      React + Vite + Tailwind SPA served by nginx-unprivileged
charts/
  store/          WordPress, MariaDB, setup Job, woo-mcp, Ingress, NetworkPolicies   (one store per release)
  mcp-server/     generic chart to host any MCP server image privately
  platform/       gateway, dashboard, Postgres, Ingress, NetworkPolicies, PDB
  */values-local.yaml, */values-prod.yaml
scripts/          gen-secrets.sh, local-up.sh (k3d), deploy.sh (any cluster, e.g. VPS)
tests/e2e.mjs     automated definition-of-done checks with the official MCP SDK client
```

---

## Local setup (k3d)

**Prerequisites:** Docker Desktop (give it about 6 GB of RAM), [k3d](https://k3d.io), kubectl, helm (v3.14+ or v4), openssl, and bash (Git Bash works on Windows).

```bash
# optional: chat agent key (free at console.groq.com); you can also add it later
export LLM_API_KEY=gsk_...

scripts/local-up.sh
```

This script:
1. creates a k3d cluster `urumi` with ports 80/443 mapped to the bundled Traefik ingress,
2. generates random credentials into `deploy/secrets/local/*.yaml` (git-ignored),
3. builds the four images and imports them into k3d,
4. creates namespaces `store-main`, `mcp-tools` and `urumi` with the **restricted** Pod Security Standard,
5. installs the three Helm releases and waits until everything is ready. The first run takes about 5 minutes, mostly the WooCommerce download.

It prints the URLs and the admin password at the end:

| | URL |
|---|---|
| Storefront | http://store.127.0.0.1.nip.io |
| WooCommerce admin | http://store.127.0.0.1.nip.io/wp-admin (user `admin`, password = `wpAdminPassword` in `deploy/secrets/local/store.yaml`) |
| Dashboard | http://app.127.0.0.1.nip.io (`admin@urumi.local`, password = `adminPassword` in `deploy/secrets/local/platform.yaml`) |
| MCP endpoint | http://app.127.0.0.1.nip.io/mcp |

To add the LLM key later, edit `llmApiKey` in `deploy/secrets/local/platform.yaml`, then run
`SKIP_BUILD=1 ONLY=platform scripts/local-up.sh`. The gateway pods roll automatically.

Iterating on one component: `ONLY=platform scripts/local-up.sh` (also `store` or `supplier`).

### Local domain approach

I use **nip.io** wildcard DNS: `anything.127.0.0.1.nip.io` resolves to `127.0.0.1` through public DNS, so the
storefront and dashboard get stable hostnames with no `/etc/hosts` edits. That works for every
browser, curl, Node and MCP client. k3d maps host port 80 to Traefik, which routes by `Host` header.

Offline alternative: add `127.0.0.1 store.urumi.test app.urumi.test` to your hosts file and set
`store.publicUrl`, `ingress.host` and `publicUrl` in the values files to those names.

WordPress gets its URL from `WP_HOME`/`WP_SITEURL`, which come from Helm values, so moving domains
never needs a database search-and-replace.

---

## Using it

### Place an order (storefront)
1. Open http://store.127.0.0.1.nip.io, choose a product, **Add to cart**, then go to **Checkout**.
2. Fill in any address and choose **Cash on delivery**. Shipping is free everywhere, so checkout always works. Click **Place order**.
3. The order appears in **WooCommerce → Orders** in wp-admin.

### Team setup (dashboard)
1. Log in as the admin. **Servers** shows WooCommerce (registered by Helm, listed first) and Supplier as *Connected*, with their tools.
2. **Team → Invite member** gives you an invite link (no email is sent). Open it in a private window and set a password.
3. Each user opens **API keys → Create key**. The key is shown once.

### Connect an external MCP client
Only the gateway URL and *your* key. You never configure the upstream servers yourself.

**Claude Code**
```bash
claude mcp add --transport http urumi http://app.127.0.0.1.nip.io/mcp --header "Authorization: Bearer ugw_YOUR_KEY"
```
**Cursor** (`~/.cursor/mcp.json`)
```json
{ "mcpServers": { "urumi": { "url": "http://app.127.0.0.1.nip.io/mcp", "headers": { "Authorization": "Bearer ugw_YOUR_KEY" } } } }
```
**MCP Inspector:** `npx @modelcontextprotocol/inspector`, transport *Streamable HTTP*, URL
`http://app.127.0.0.1.nip.io/mcp`, header `Authorization: Bearer ugw_YOUR_KEY`.

Tools appear as `woocommerce__list_orders`, `supplier__get_quote` and so on. Try:
- *"What orders came in today?"*
- *"Which supplier products don't we sell yet? Quote 100 units of the cheapest one in INR."* This needs both servers.

Append `?mode=search` to the URL to get two meta-tools (`gateway__search_tools`, `gateway__call_tool`) instead of the full list. That's for clients that would otherwise receive hundreds of tools.

### Chat agent
Dashboard → **Chat**. It calls tools through the same gateway endpoint as the logged-in user, shows
each tool call and result as it happens, and every call lands in the audit log under that user with
`client = chat`.

### Automated end-to-end check
```bash
cd tests && npm ci
BASE_URL=http://app.127.0.0.1.nip.io ADMIN_PASSWORD=<adminPassword> node e2e.mjs
```
It creates a member, issues keys, and checks:
- aggregation and prefixes,
- role-based hiding,
- routing,
- denied direct calls,
- disabling a server,
- revoking a key,
- the audit log.

It cleans up after itself.

---

## Production-like VPS (k3s)

The **same charts**; only `values-prod.yaml` and the secrets differ (see the table in
[DESIGN.md §6](docs/DESIGN.md#6-local-vs-production-only-helm-values-change)).

1. **VPS:** a 2 vCPU / 4 GB Ubuntu VM is enough. Point two DNS A records (`store.example.com`,
   `app.example.com`) at it and open ports 80/443.
2. **k3s** (bundles Traefik, the local-path storage class, and a NetworkPolicy controller):
   ```bash
   curl -sfL https://get.k3s.io | sh -
   mkdir -p ~/.kube && sudo cat /etc/rancher/k3s/k3s.yaml > ~/.kube/config
   ```
3. **TLS** with cert-manager and Let's Encrypt:
   ```bash
   helm repo add jetstack https://charts.jetstack.io
   helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true
   kubectl apply -f - <<'EOF'
   apiVersion: cert-manager.io/v1
   kind: ClusterIssuer
   metadata: { name: letsencrypt-prod }
   spec:
     acme:
       server: https://acme-v02.api.letsencrypt.org/directory
       email: you@example.com
       privateKeySecretRef: { name: letsencrypt-prod }
       solvers: [{ http01: { ingress: { ingressClassName: traefik } } }]
   EOF
   ```
4. **Images:** push a tag `v1.0.0`, and CI (`.github/workflows/ci.yml`) builds multi-arch images to
   `ghcr.io/<owner>/urumi-*:v1.0.0`. Without a registry, use
   `docker save urumi/gateway:TAG | ssh vps sudo k3s ctr images import -` per image.
5. **Values:** replace `example.com` and `CHANGE_ME` in the three `values-prod.yaml` files.
6. **Secrets and deploy:**
   ```bash
   LLM_API_KEY=gsk_... scripts/gen-secrets.sh prod   # writes deploy/secrets/prod/*.yaml (keep these off git)
   REGISTRY=ghcr.io/<owner> TAG=v1.0.0 scripts/deploy.sh prod
   ```
   To manage secrets out of band instead (sealed-secrets, external-secrets, SOPS), create the
   Secrets yourself and set `secrets.existingSecret` in each chart.

What changes between local and prod: domain and `publicUrl`; TLS plus cert-manager annotations on the
Ingress; storage class and sizes; image registry and tags; `cookieSecure: true`; resource sizes;
replica counts.

## Upgrades and rollback

```bash
helm history platform -n urumi
REGISTRY=... TAG=v1.1.0 scripts/deploy.sh prod      # upgrade = new image tag
helm rollback platform <REVISION> -n urumi          # rollback = previous revision
```
- **Gateway / dashboard:** RollingUpdate with `maxUnavailable: 0` and a PodDisruptionBudget, so at
  least one gateway replica is always serving. MCP sessions survive the roll because session IDs are
  signed tokens any replica accepts. DB migrations are forward-only and additive (expand/contract),
  so the previous image runs against the newer schema and rollback is safe.
- **MCP servers:** stateless, so a rolling update is invisible to the gateway beyond in-flight calls.
  The gateway reconnects automatically.
- **Store:** bump `setup.woocommerceVersion` (or `wordpress.image`). The `post-upgrade` hook Job
  installs the pinned version and runs `wp wc update`. `helm rollback` runs the same Job
  (`post-rollback`) to re-pin the previous version. WooCommerce DB migrations aren't reversible, so
  back up first:
  `kubectl exec -n store-main store-mariadb-0 -- sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" wordpress' > backup.sql`.
  `MARIADB_AUTO_UPGRADE=1` handles MariaDB minor upgrades.

---

## What's implemented beyond the core

| Stand-out item | Where |
|---|---|
| **Tool permissions** per role/tool: hidden from `tools/list` *and* rejected on direct call. Woo write tools are admin-only by default | `gateway/src/catalog.ts`, server detail page |
| **Security hardening:** SSRF guard at validation *and* connect time (DNS rebinding), deny-by-default NetworkPolicies, Pod Security `restricted`, non-root, read-only root filesystems, no ServiceAccount tokens, credentials AES-256-GCM encrypted at rest, peppered key hashes | `gateway/src/ssrf.ts`, `crypto.ts`, `charts/*/networkpolicies.yaml` |
| **Tool definition pinning** (rug-pull defence) with an approval diff and poisoning heuristics | `gateway/src/upstreams.ts` `syncTools`, `catalog.ts` `flagsFor` |
| **Scaling:** 2 gateway replicas with no sticky sessions (signed session IDs) and cross-replica `tools/list_changed` push via Postgres LISTEN/NOTIFY; per-user rate limits | `gateway/src/mcp.ts`, `events.ts` |
| **Many tools:** `?mode=search` meta-tools; the agent switches automatically above 40 tools | `gateway/src/mcp.ts`, `agent.ts` |
| **Observability:** Prometheus `/metrics` on an internal port (calls, errors, latency per server, upstream up/down); dashboard overview from the audit log; precise unreachable reasons | `gateway/src/metrics.ts`, Overview page |
| **Upgrades and rollback:** zero-downtime gateway rolls, a pinned WooCommerce version, a rollback hook | section above |
| **Production-like deployment:** prod values, cert-manager TLS, CI multi-arch images to GHCR | `values-prod.yaml`, `.github/workflows/ci.yml` |

Not attempted: multi-store provisioning (bonus), OAuth on the gateway, hosted MCP servers by image.
The store chart is already one-store-per-namespace with its own MCP server, which is the foundation
for provisioning.
