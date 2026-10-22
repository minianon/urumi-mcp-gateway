/** Static wholesale catalog for the demo supplier. Costs are in USD. */
export interface SupplierProduct {
  sku: string;
  name: string;
  category: string;
  unit_cost_usd: number;
  min_order_qty: number;
  lead_time_days: number;
  available_qty: number;
  description: string;
}

export const SUPPLIER_NAME = 'Northwind Wholesale';

export const catalog: SupplierProduct[] = [
  { sku: 'NW-MUG-001', name: 'Ceramic Mug', category: 'Kitchen', unit_cost_usd: 3.2, min_order_qty: 24, lead_time_days: 5, available_qty: 1800, description: '350 ml stoneware mug, matte glaze, dishwasher safe.' },
  { sku: 'NW-BTL-002', name: 'Insulated Water Bottle', category: 'Outdoor', unit_cost_usd: 7.8, min_order_qty: 12, lead_time_days: 7, available_qty: 640, description: '750 ml double-wall stainless steel, keeps cold 24h.' },
  { sku: 'NW-TEE-003', name: 'Organic Cotton T-Shirt', category: 'Apparel', unit_cost_usd: 5.5, min_order_qty: 25, lead_time_days: 10, available_qty: 3200, description: '180 gsm GOTS-certified cotton, unisex fit.' },
  { sku: 'NW-HOD-004', name: 'Fleece Hoodie', category: 'Apparel', unit_cost_usd: 14.9, min_order_qty: 10, lead_time_days: 12, available_qty: 450, description: '320 gsm brushed fleece, kangaroo pocket.' },
  { sku: 'NW-TOT-005', name: 'Canvas Tote Bag', category: 'Accessories', unit_cost_usd: 2.4, min_order_qty: 50, lead_time_days: 6, available_qty: 5000, description: '12 oz natural canvas, 38×42 cm.' },
  { sku: 'NW-NBK-006', name: 'Dot Grid Notebook', category: 'Stationery', unit_cost_usd: 3.9, min_order_qty: 20, lead_time_days: 4, available_qty: 2100, description: 'A5, 160 pages, 100 gsm paper, lay-flat binding.' },
  { sku: 'NW-CAP-007', name: 'Embroidered Cap', category: 'Apparel', unit_cost_usd: 4.6, min_order_qty: 24, lead_time_days: 9, available_qty: 900, description: 'Six-panel cotton twill, adjustable strap.' },
  { sku: 'NW-SCK-008', name: 'Merino Socks', category: 'Apparel', unit_cost_usd: 3.1, min_order_qty: 30, lead_time_days: 8, available_qty: 1500, description: 'Mid-weight merino blend, cushioned sole.' },
  { sku: 'NW-CND-009', name: 'Soy Wax Candle', category: 'Home', unit_cost_usd: 4.2, min_order_qty: 24, lead_time_days: 6, available_qty: 700, description: '200 g amber jar, cedar & vanilla, 40h burn.' },
  { sku: 'NW-STK-010', name: 'Vinyl Sticker Pack', category: 'Stationery', unit_cost_usd: 0.9, min_order_qty: 100, lead_time_days: 3, available_qty: 12000, description: 'Pack of 8 waterproof die-cut stickers.' },
  { sku: 'NW-PHN-011', name: 'Phone Stand', category: 'Accessories', unit_cost_usd: 2.8, min_order_qty: 40, lead_time_days: 5, available_qty: 1300, description: 'Foldable aluminium stand, fits 4–13" devices.' },
  { sku: 'NW-BKP-012', name: 'Laptop Backpack', category: 'Accessories', unit_cost_usd: 18.5, min_order_qty: 6, lead_time_days: 14, available_qty: 260, description: '20 L recycled polyester, padded 15" sleeve.' },
];

/**
 * Indicative FX rates (units of currency per 1 USD). Static on purpose: this server exists to
 * show multi-server tool calls, not to be a market-data feed.
 */
export const RATES_AS_OF = '2026-10-01';
export const usdRates: Record<string, number> = {
  USD: 1,
  EUR: 0.86,
  GBP: 0.75,
  INR: 88.4,
  JPY: 149.2,
  AUD: 1.52,
  CAD: 1.39,
  SGD: 1.29,
  AED: 3.6725,
};

/** Tiered volume discount applied to quotes. */
export function volumeDiscount(qty: number): number {
  if (qty >= 500) return 0.15;
  if (qty >= 200) return 0.1;
  if (qty >= 100) return 0.05;
  return 0;
}
