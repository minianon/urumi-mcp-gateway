<?php
/**
 * Registers (or rotates) the WooCommerce REST API key used by the MCP server.
 *
 * The key/secret pair is generated outside WordPress and stored in a Kubernetes Secret, so the
 * MCP server and this Job read the same values and nothing has to be copied out of wp-admin.
 * WooCommerce stores the consumer key as an HMAC (wc_api_hash) and the secret in clear, exactly
 * as its own key-generation screen does.
 */
global $wpdb;

$ck   = getenv('WC_CONSUMER_KEY');
$cs   = getenv('WC_CONSUMER_SECRET');
$user = get_user_by('login', getenv('WP_ADMIN_USER'));
if (!$ck || !$cs || !$user) {
    WP_CLI::error('WC_CONSUMER_KEY, WC_CONSUMER_SECRET and a valid WP_ADMIN_USER are required');
}

$table = $wpdb->prefix . 'woocommerce_api_keys';
$data  = array(
    'user_id'         => $user->ID,
    'description'     => 'urumi-mcp (managed by Helm)',
    'permissions'     => 'read_write',
    'consumer_key'    => wc_api_hash($ck),
    'consumer_secret' => $cs,
    'truncated_key'   => substr($ck, -7),
);

$existing = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$table} WHERE description = %s", $data['description']));
if ($existing) {
    $wpdb->update($table, $data, array('key_id' => $existing));
    WP_CLI::success("REST API key {$existing} updated");
} else {
    $wpdb->insert($table, $data);
    WP_CLI::success('REST API key created');
}
