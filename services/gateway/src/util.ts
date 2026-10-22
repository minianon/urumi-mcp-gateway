import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Deterministic JSON (sorted keys) so equal definitions always hash the same. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Express 5 forwards rejected promises to the error handler, this just keeps handlers terse. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function describeError(err: unknown): string {
  const e = err as Error & { code?: unknown; cause?: Error & { code?: string } };
  const cause = e?.cause;
  if (cause?.code) return `${cause.code}: ${cause.message}`;
  if (cause?.message && e.message === 'fetch failed') return cause.message;
  return e?.message ?? String(err);
}

export const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + `… [truncated ${s.length - max} chars]` : s);
