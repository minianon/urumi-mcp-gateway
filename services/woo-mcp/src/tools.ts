import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from './config.ts';
import { resolvePeriod, toWooGmt, type Period } from './dates.ts';
import { WooError, wooList, wooRequest } from './woo.ts';

// --- WooCommerce REST shapes (only the fields we use) ---------------------------------------

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  total_sales: number;
  short_description: string;
  description: string;
  categories: { id: number; name: string }[];
  date_created_gmt: string;
}

interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: string;
  date_created: string;
  date_created_gmt: string;
  payment_method_title: string;
  customer_note: string;
  billing: { first_name: string; last_name: string; email: string; phone: string; city: string; country: string };
  shipping: { first_name: string; last_name: string; address_1: string; city: string; postcode: string; country: string };
  line_items: { product_id: number; name: string; quantity: number; total: string; sku: string }[];
  shipping_total: string;
  discount_total: string;
}

// --- Formatting: hand the model compact, predictable JSON -----------------------------------

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

let currencyCache: string | undefined;
async function storeCurrency(): Promise<string> {
  if (!currencyCache) {
    const c = await wooRequest<{ code: string }>('GET', '/data/currencies/current').catch(() => ({ code: 'unknown' }));
    currencyCache = c.code;
  }
  return currencyCache;
}

const productSummary = (p: WooProduct, currency: string) => ({
  id: p.id,
  name: p.name,
  sku: p.sku || null,
  status: p.status,
  price: p.price,
  regular_price: p.regular_price,
  sale_price: p.sale_price || null,
  currency,
  stock_status: p.stock_status,
  stock_quantity: p.manage_stock ? p.stock_quantity : null,
  total_sales: p.total_sales,
  categories: p.categories.map((c) => c.name),
  url: p.permalink,
});

const orderSummary = (o: WooOrder) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  total: o.total,
  currency: o.currency,
  created_at_utc: o.date_created_gmt + 'Z',
  created_at_store_time: o.date_created,
  customer: `${o.billing.first_name} ${o.billing.last_name}`.trim() || null,
  email: o.billing.email || null,
  payment_method: o.payment_method_title,
  items: o.line_items.map((li) => `${li.quantity} × ${li.name}`),
});

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Errors are returned as tool results (isError) so the model can read and react to them. */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    const msg =
      err instanceof WooError ? `WooCommerce error (HTTP ${err.status}, ${err.code}): ${err.message}` : `Unexpected error: ${(err as Error).message}`;
    return { isError: true, content: [{ type: 'text', text: msg }] };
  }
}

const ORDER_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'] as const;
const PERIODS = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month'] as const;
const PAID_STATUSES = ['processing', 'completed', 'on-hold'];
const money = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a decimal string like "19.99"')
  .describe('Price as a decimal string, e.g. "19.99", in the store currency');

/** Resolve a category name to an id, creating it if it does not exist. */
async function categoryId(name: string): Promise<number> {
  const { items } = await wooList<{ id: number; name: string }>('/products/categories', { search: name, per_page: 20 });
  const hit = items.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const created = await wooRequest<{ id: number }>('POST', '/products/categories', {}, { name });
  return created.id;
}

// --- Tools ----------------------------------------------------------------------------------

export function registerTools(server: McpServer) {
  const store = config.storeName;

  server.registerTool(
    'list_products',
    {
      title: 'List products',
      description: `List or search products in the ${store} WooCommerce catalog. Returns id, name, SKU, price, stock and storefront URL.`,
      inputSchema: {
        search: z.string().optional().describe('Free-text search on product name/description'),
        sku: z.string().optional().describe('Exact SKU match'),
        status: z.enum(['publish', 'draft', 'pending', 'private', 'any']).default('any'),
        stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional(),
        per_page: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        const [currency, res] = await Promise.all([storeCurrency(), wooList<WooProduct>('/products', { ...args, orderby: 'date', order: 'desc' })]);
        return { store, total: res.total, page: args.page, total_pages: res.totalPages, products: res.items.map((p) => productSummary(p, currency)) };
      }),
  );

  server.registerTool(
    'get_product',
    {
      title: 'Get product',
      description: `Get full details of one product in ${store} by its numeric id.`,
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      run(async () => {
        const [currency, p] = await Promise.all([storeCurrency(), wooRequest<WooProduct>('GET', `/products/${id}`)]);
        return { ...productSummary(p, currency), description: stripHtml(p.description), short_description: stripHtml(p.short_description) };
      }),
  );

  server.registerTool(
    'create_product',
    {
      title: 'Create product',
      description: `Create a new simple product in ${store}. It is published to the storefront immediately unless status is "draft". Returns the new product including its storefront URL.`,
      inputSchema: {
        name: z.string().min(1).max(200),
        regular_price: money,
        sale_price: money.optional(),
        description: z.string().max(5000).optional(),
        short_description: z.string().max(1000).optional(),
        sku: z.string().max(100).optional(),
        stock_quantity: z.number().int().min(0).optional().describe('If set, stock is tracked with this quantity'),
        category: z.string().max(100).optional().describe('Category name; created if it does not exist'),
        status: z.enum(['publish', 'draft']).default('publish'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        const body: Record<string, unknown> = {
          name: args.name,
          type: 'simple',
          status: args.status,
          regular_price: args.regular_price,
          sale_price: args.sale_price,
          description: args.description,
          short_description: args.short_description,
          sku: args.sku,
        };
        if (args.stock_quantity !== undefined) Object.assign(body, { manage_stock: true, stock_quantity: args.stock_quantity });
        if (args.category) body.categories = [{ id: await categoryId(args.category) }];
        const [currency, p] = await Promise.all([storeCurrency(), wooRequest<WooProduct>('POST', '/products', {}, body)]);
        return { created: true, product: productSummary(p, currency) };
      }),
  );

  server.registerTool(
    'update_product',
    {
      title: 'Update product',
      description: `Update price, stock, name or status of an existing product in ${store}. Only the fields you pass are changed.`,
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        regular_price: money.optional(),
        sale_price: z.union([money, z.literal('')]).optional().describe('Empty string removes the sale price'),
        stock_quantity: z.number().int().min(0).optional(),
        status: z.enum(['publish', 'draft', 'private']).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, ...fields }) =>
      run(async () => {
        const body: Record<string, unknown> = { ...fields };
        if (fields.stock_quantity !== undefined) body.manage_stock = true;
        const [currency, p] = await Promise.all([storeCurrency(), wooRequest<WooProduct>('PUT', `/products/${id}`, {}, body)]);
        return { updated: true, product: productSummary(p, currency) };
      }),
  );

  server.registerTool(
    'list_orders',
    {
      title: 'List orders',
      description:
        `List orders in ${store}, newest first. Use "period" for questions like "orders today" — it is resolved in the store's ` +
        `timezone (${config.storeTimezone}), so you do not need to compute dates. "after"/"before" accept ISO-8601 UTC timestamps for custom ranges.`,
      inputSchema: {
        period: z.enum(PERIODS).optional(),
        after: z.string().datetime({ offset: true }).optional().describe('Only orders created at/after this ISO-8601 time'),
        before: z.string().datetime({ offset: true }).optional().describe('Only orders created before this ISO-8601 time'),
        status: z.enum(['any', ...ORDER_STATUSES]).default('any'),
        search: z.string().optional().describe('Search by customer name, email, or order number'),
        per_page: z.number().int().min(1).max(100).default(20),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        let after = args.after ? new Date(args.after) : undefined;
        let before = args.before ? new Date(args.before) : undefined;
        let range: string | undefined;
        if (args.period) {
          const p = resolvePeriod(args.period as Period, config.storeTimezone);
          after = p.after;
          before = p.before;
          range = p.label;
        }
        const res = await wooList<WooOrder>('/orders', {
          status: args.status,
          search: args.search,
          per_page: args.per_page,
          page: args.page,
          after: after && toWooGmt(after),
          before: before && toWooGmt(before),
          dates_are_gmt: after || before ? true : undefined,
          orderby: 'date',
          order: 'desc',
        });
        return {
          store,
          range: range ?? (after || before ? { after: after?.toISOString(), before: before?.toISOString() } : 'all time'),
          total: res.total,
          page: args.page,
          total_pages: res.totalPages,
          orders: res.items.map(orderSummary),
        };
      }),
  );

  server.registerTool(
    'get_order',
    {
      title: 'Get order',
      description: `Get full details of one order in ${store}: line items, customer, shipping address, totals and status.`,
      inputSchema: { id: z.number().int().positive() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ id }) =>
      run(async () => {
        const o = await wooRequest<WooOrder>('GET', `/orders/${id}`);
        return {
          ...orderSummary(o),
          line_items: o.line_items.map((li) => ({ product_id: li.product_id, name: li.name, sku: li.sku || null, quantity: li.quantity, total: li.total })),
          shipping_total: o.shipping_total,
          discount_total: o.discount_total,
          customer_note: o.customer_note || null,
          billing: { name: `${o.billing.first_name} ${o.billing.last_name}`.trim(), email: o.billing.email, phone: o.billing.phone, city: o.billing.city, country: o.billing.country },
          shipping: o.shipping,
        };
      }),
  );

  server.registerTool(
    'update_order_status',
    {
      title: 'Update order status',
      description: `Change the status of an order in ${store} (e.g. processing → completed). Optionally adds a private note to the order explaining the change.`,
      inputSchema: {
        id: z.number().int().positive(),
        status: z.enum(ORDER_STATUSES),
        note: z.string().max(1000).optional().describe('Private order note (not sent to the customer)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ id, status, note }) =>
      run(async () => {
        const before = await wooRequest<WooOrder>('GET', `/orders/${id}`);
        const o = await wooRequest<WooOrder>('PUT', `/orders/${id}`, {}, { status });
        if (note) await wooRequest('POST', `/orders/${id}/notes`, {}, { note, customer_note: false });
        return { updated: true, id: o.id, number: o.number, previous_status: before.status, status: o.status };
      }),
  );

  server.registerTool(
    'sales_summary',
    {
      title: 'Sales summary',
      description: `Aggregate ${store}'s orders for a period: order count, revenue from paid orders, average order value, status breakdown and best-selling items. Good for comparing periods or stores.`,
      inputSchema: { period: z.enum(PERIODS).default('today') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ period }) =>
      run(async () => {
        const p = resolvePeriod(period as Period, config.storeTimezone);
        const orders: WooOrder[] = [];
        for (let page = 1; page <= 10; page++) {
          const res = await wooList<WooOrder>('/orders', { after: toWooGmt(p.after), before: toWooGmt(p.before), dates_are_gmt: true, per_page: 100, page });
          orders.push(...res.items);
          if (!res.totalPages || page >= res.totalPages) break;
        }
        const paid = orders.filter((o) => PAID_STATUSES.includes(o.status));
        const revenue = paid.reduce((s, o) => s + Number(o.total), 0);
        const byStatus: Record<string, number> = {};
        const items: Record<string, number> = {};
        for (const o of orders) {
          byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
          for (const li of o.line_items) items[li.name] = (items[li.name] ?? 0) + li.quantity;
        }
        return {
          store,
          range: p.label,
          orders: orders.length,
          paid_orders: paid.length,
          revenue: revenue.toFixed(2),
          currency: orders[0]?.currency ?? (await storeCurrency()),
          average_order_value: paid.length ? (revenue / paid.length).toFixed(2) : '0.00',
          by_status: byStatus,
          top_items: Object.entries(items)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, quantity]) => ({ name, quantity })),
        };
      }),
  );
}
