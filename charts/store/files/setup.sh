#!/bin/sh
# Idempotent store setup. Runs as a Helm post-install/post-upgrade hook, so every step must be
# safe to repeat: re-running converges the store to the state described by the Helm values.
set -eu
cd /var/www/html
log() { echo "[setup] $*"; }
# Cosmetic options must never fail the whole setup (some are guarded by WooCommerce filters).
opt() { wp option update "$@" >/dev/null 2>&1 || log "warning: could not set option $1"; }

log "waiting for WordPress files and wp-config.php (created by the WordPress pod on first start)"
until [ -f wp-config.php ] && [ -f wp-includes/version.php ]; do sleep 3; done

log "waiting for the database"
until wp db query "SELECT 1" >/dev/null 2>&1; do sleep 3; done

if ! wp core is-installed 2>/dev/null; then
  log "installing WordPress core"
  wp core install --url="$WP_PUBLIC_URL" --title="$STORE_NAME" \
    --admin_user="$WP_ADMIN_USER" --admin_password="$WP_ADMIN_PASSWORD" --admin_email="$WP_ADMIN_EMAIL" --skip-email
else
  # Keep the admin password in sync with the Secret (rotation via Helm).
  wp user update "$WP_ADMIN_USER" --user_pass="$WP_ADMIN_PASSWORD" --skip-email >/dev/null
fi
wp option update blogname "$STORE_NAME" >/dev/null
wp option update timezone_string "$STORE_TIMEZONE" >/dev/null
wp rewrite structure '/%postname%/' --hard >/dev/null

current="$(wp plugin get woocommerce --field=version 2>/dev/null || echo none)"
if [ "$current" != "$WC_VERSION" ]; then
  log "installing WooCommerce $WC_VERSION (was: $current)"
  wp plugin install woocommerce --version="$WC_VERSION" --force
fi
wp plugin is-active woocommerce || wp plugin activate woocommerce
# Run any pending WooCommerce DB migrations after an upgrade.
wp wc update >/dev/null 2>&1 || true

if ! wp theme is-installed "$WP_THEME"; then wp theme install "$WP_THEME"; fi
wp theme activate "$WP_THEME" >/dev/null

log "configuring WooCommerce"
wp option update woocommerce_currency "$STORE_CURRENCY" >/dev/null
wp option update woocommerce_default_country "$STORE_COUNTRY" >/dev/null
wp option update woocommerce_coming_soon no >/dev/null # new stores start in "coming soon" mode
opt woocommerce_store_pages_only no
opt woocommerce_onboarding_profile '{"skipped":true}' --format=json
opt woocommerce_task_list_hidden yes
opt woocommerce_allow_tracking no
wp option update woocommerce_cod_settings \
  '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery.","enable_for_methods":[],"enable_for_virtual":"yes"}' \
  --format=json >/dev/null
wp wc tool run install_pages --user="$WP_ADMIN_USER" >/dev/null 2>&1 || true

# Free shipping for "locations not covered by other zones" (zone 0), so checkout always works.
if ! wp wc shipping_zone_method list 0 --user="$WP_ADMIN_USER" --field=method_id 2>/dev/null | grep -q free_shipping; then
  wp wc shipping_zone_method create 0 --method_id=free_shipping --enabled=true --user="$WP_ADMIN_USER" >/dev/null
fi

log "registering the MCP server's REST API key"
wp eval-file /setup/api-key.php

if [ "$SAMPLE_PRODUCTS" = "true" ] && [ "$(wp option get urumi_seeded 2>/dev/null || echo no)" != "yes" ]; then
  log "creating sample products"
  wp wc product create --user="$WP_ADMIN_USER" --name="Urumi Classic Tee" --type=simple --regular_price=799 --sku=URU-TEE --short_description="Soft cotton tee with the Urumi logo." >/dev/null
  wp wc product create --user="$WP_ADMIN_USER" --name="Kubernetes Coffee Mug" --type=simple --regular_price=449 --sku=URU-MUG --short_description="350 ml mug for long kubectl sessions." >/dev/null
  wp wc product create --user="$WP_ADMIN_USER" --name="MCP Sticker Pack" --type=simple --regular_price=149 --sku=URU-STK --short_description="Eight die-cut stickers." >/dev/null
  wp wc product create --user="$WP_ADMIN_USER" --name="Helm Hoodie" --type=simple --regular_price=1999 --sku=URU-HOOD --short_description="Warm fleece hoodie for cold clusters." >/dev/null
  wp option update urumi_seeded yes >/dev/null
fi

wp cache flush >/dev/null 2>&1 || true
log "done"
