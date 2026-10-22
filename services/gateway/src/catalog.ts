import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.ts';
import { sha256 } from './crypto.ts';
import { q } from './db.ts';
import { events } from './events.ts';
import { upstreams, type ToolDefinition } from './upstreams.ts';

export type Role = 'admin' | 'member';
export type ToolStatus = 'active' | 'pending' | 'changed';

export interface CatalogTool {
  serverId: string;
  serverSlug: string;
  serverName: string;
  serverEnabled: boolean;
  name: string;
  exposedName: string;
  definition: ToolDefinition;
  approvedDefinition: ToolDefinition | null;
  status: ToolStatus;
  enabled: boolean;
  minRole: Role;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Collision scheme: every tool is exposed as "<server-slug>__<tool-name>".
 * Slugs are unique, lowercase and cannot contain "__", so the split is unambiguous and the name
 * tells the model (and the human reading the audit log) which system a tool acts on. MCP clients
 * cap names at 64 chars; longer names are shortened with a stable hash suffix.
 */
export function exposedNameFor(slug: string, tool: string): string {
  const full = `${slug}__${tool}`;
  if (full.length <= 64) return full;
  return `${full.slice(0, 55)}_${sha256(full).slice(0, 8)}`;
}

const roleRank: Record<Role, number> = { member: 0, admin: 1 };
export const roleAllows = (role: Role, min: Role) => roleRank[role] >= roleRank[min];

let cache: { at: number; tools: CatalogTool[] } | undefined;
events.on('tools_changed', () => (cache = undefined));
events.on('servers_changed', () => (cache = undefined));

/** Full catalogue (all servers, all states). Cached for a few seconds; invalidated by events. */
export async function loadCatalog(): Promise<CatalogTool[]> {
  if (cache && Date.now() - cache.at < 5_000) return cache.tools;
  const rows = await q(
    `SELECT t.*, s.slug, s.name AS server_name, s.enabled AS server_enabled
       FROM server_tools t JOIN servers s ON s.id = t.server_id
      WHERE t.present
      ORDER BY s.slug, t.name`,
  );
  const tools = rows.map(
    (r): CatalogTool => ({
      serverId: r.server_id,
      serverSlug: r.slug,
      serverName: r.server_name,
      serverEnabled: r.server_enabled,
      name: r.name,
      exposedName: exposedNameFor(r.slug, r.name),
      definition: r.definition,
      approvedDefinition: r.approved_definition,
      status: !r.approved_hash ? 'pending' : r.approved_hash !== r.def_hash ? 'changed' : 'active',
      enabled: r.enabled,
      minRole: r.min_role,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }),
  );
  cache = { at: Date.now(), tools };
  return tools;
}

export type Resolution =
  | { ok: true; tool: CatalogTool }
  | { ok: false; reason: 'not_found' | 'denied' | 'unavailable' | 'review'; message: string; tool?: CatalogTool };

/** Everything a user may currently see and call. */
export async function visibleTools(role: Role): Promise<CatalogTool[]> {
  return (await loadCatalog()).filter((t) => checkVisible(t, role).ok);
}

export async function resolveTool(role: Role, exposedName: string): Promise<Resolution> {
  const tool = (await loadCatalog()).find((t) => t.exposedName === exposedName);
  if (!tool) return { ok: false, reason: 'not_found', message: `Unknown tool "${exposedName}"` };
  return checkVisible(tool, role);
}

function checkVisible(tool: CatalogTool, role: Role): Resolution {
  if (!tool.serverEnabled) return { ok: false, reason: 'unavailable', message: `Server "${tool.serverSlug}" is disabled`, tool };
  if (!upstreams.isConnected(tool.serverId)) return { ok: false, reason: 'unavailable', message: `Server "${tool.serverSlug}" is unreachable`, tool };
  if (tool.status !== 'active') return { ok: false, reason: 'review', message: `Tool "${tool.exposedName}" is awaiting admin review`, tool };
  if (!tool.enabled) return { ok: false, reason: 'denied', message: `Tool "${tool.exposedName}" is disabled by an admin`, tool };
  if (!roleAllows(role, tool.minRole)) return { ok: false, reason: 'denied', message: `Tool "${tool.exposedName}" requires the ${tool.minRole} role`, tool };
  return { ok: true, tool };
}

// Zero-width and bidi-control characters can hide instructions from a human reviewer.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]|[\u{E0000}-\u{E007F}]/gu;

/** The MCP Tool object a downstream client receives. */
export function toMcpTool(t: CatalogTool): Tool {
  const desc = t.definition.description.replace(INVISIBLE, '');
  const max = config.upstream.maxDescriptionChars;
  return {
    name: t.exposedName,
    title: t.definition.title ? `${t.definition.title} (${t.serverName})` : undefined,
    description: `[${t.serverName}] ${desc.length > max ? desc.slice(0, max) + '…' : desc}`,
    inputSchema: t.definition.inputSchema,
    ...(t.definition.outputSchema ? { outputSchema: t.definition.outputSchema } : {}),
    ...(t.definition.annotations ? { annotations: t.definition.annotations } : {}),
  };
}

/**
 * Heuristic red flags in upstream-provided text, shown to admins next to each tool. Not a
 * security boundary (an attacker can phrase around regexes), but it makes the obvious tool
 * poisoning patterns visible during review.
 */
export function flagsFor(def: ToolDefinition, allToolNames: string[]): string[] {
  // Scan what the model reads: titles, descriptions and schema text, minus the "$schema" URI.
  const { $schema: _ignored, ...schema } = (def.inputSchema ?? {}) as Record<string, unknown>;
  const text = `${def.title ?? ''}\n${def.description}\n${JSON.stringify(schema)}`;
  const flags: string[] = [];
  if (/ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts|messages)|disregard (the |all )?(previous |prior )?instructions|you are now|new instructions/i.test(text))
    flags.push('instruction-override');
  if (/<\/?(important|system|instructions?|secret)>|do not (tell|mention|inform|reveal)|without (telling|informing|asking) the user|the user (must not|should not) know/i.test(text))
    flags.push('hidden-directive');
  if (/(api[ _-]?key|password|passwd|secret|private key|ssh|\.env\b|credentials?|access token|bearer)/i.test(text)) flags.push('mentions-secrets');
  if (/https?:\/\/|send (it|them|the \w+) to|exfiltrat|webhook/i.test(text)) flags.push('mentions-urls');
  if (allToolNames.some((n) => n.length > 4 && text.includes(n)) || /\b(before|after|instead of) (using|calling) (any|the|another) \w* ?tool/i.test(text))
    flags.push('mentions-other-tools');
  if (INVISIBLE.test(text)) flags.push('invisible-characters');
  INVISIBLE.lastIndex = 0;
  if (def.description.length > 1500) flags.push('very-long-description');
  return flags;
}
