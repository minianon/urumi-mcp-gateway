/**
 * "Orders that came in today" depends on the store's timezone, not the pod's (UTC) or the
 * model's guess. We resolve named periods to exact UTC boundaries here so the LLM never has to
 * do timezone arithmetic.
 */

export type Period = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month';

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - instant.getTime();
}

/** Calendar date (y, m, d) of `instant` in `tz`. */
function zonedYmd(instant: Date, tz: string): [number, number, number] {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return [y, m, d];
}

/** UTC instant of local midnight for the given calendar date in `tz`. */
function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  // Two passes handle DST transitions around midnight.
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

export function resolvePeriod(period: Period, tz: string, now = new Date()): { after: Date; before: Date; label: string } {
  const [y, m, d] = zonedYmd(now, tz);
  const startOfToday = zonedMidnight(y, m, d, tz);
  const day = 24 * 3600 * 1000;
  switch (period) {
    case 'today':
      return { after: startOfToday, before: now, label: `today (${y}-${pad(m)}-${pad(d)}, ${tz})` };
    case 'yesterday': {
      const [yy, ym, yd] = zonedYmd(new Date(startOfToday.getTime() - day / 2), tz);
      return { after: zonedMidnight(yy, ym, yd, tz), before: startOfToday, label: `yesterday (${yy}-${pad(ym)}-${pad(yd)}, ${tz})` };
    }
    case 'last_7_days':
      return { after: new Date(startOfToday.getTime() - 6 * day), before: now, label: `the last 7 days (${tz})` };
    case 'last_30_days':
      return { after: new Date(startOfToday.getTime() - 29 * day), before: now, label: `the last 30 days (${tz})` };
    case 'this_month':
      return { after: zonedMidnight(y, m, 1, tz), before: now, label: `this month (${y}-${pad(m)}, ${tz})` };
  }
}

/** WooCommerce expects ISO-8601 without timezone; with dates_are_gmt=true it is read as UTC. */
export function toWooGmt(d: Date): string {
  return d.toISOString().slice(0, 19);
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
