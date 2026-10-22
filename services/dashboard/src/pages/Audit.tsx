import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { CircleAlert, RefreshCw, ScrollText, X } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { formatDateTime, formatMs, formatRelative } from '../lib/format'
import { qk, useIsAdmin, useServers } from '../lib/queries'
import type { AuditClient, AuditEntry, AuditFilters, AuditOutcome } from '../lib/types'
import { Page, PageHeader } from '../components/layout/PageHeader'
import { Badge, type Tone } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Select } from '../components/ui/Input'
import { TableSkeleton } from '../components/ui/Skeleton'
import { Switch } from '../components/ui/Switch'
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table'
import { Tooltip } from '../components/ui/Tooltip'

const PAGE_SIZE = 50

const OUTCOME: Record<AuditOutcome, { tone: Tone; label: string }> = {
  success: { tone: 'green', label: 'Success' },
  error: { tone: 'red', label: 'Error' },
  timeout: { tone: 'amber', label: 'Timeout' },
  denied: { tone: 'purple', label: 'Denied' },
  unauthorized: { tone: 'purple', label: 'Unauthorized' },
}

function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const o = OUTCOME[outcome] ?? { tone: 'gray' as Tone, label: outcome }
  return (
    <Badge tone={o.tone} dot>
      {o.label}
    </Badge>
  )
}

function ClientBadge({ client }: { client: AuditClient }) {
  return client === 'chat' ? <Badge tone="indigo">Chat</Badge> : <Badge tone="gray">MCP</Badge>
}

function ToolCell({ e }: { e: AuditEntry }) {
  if (e.exposedName || e.tool) {
    return <code className="font-mono text-[12px] text-zinc-800">{e.exposedName ?? `${e.serverSlug ?? '?'}__${e.tool}`}</code>
  }
  return <span className="font-mono text-[12px] text-zinc-400">{e.method}</span>
}

const EMPTY_FILTERS: Required<AuditFilters> = { userId: '', serverSlug: '', outcome: '', client: '' }

export function AuditPage() {
  const isAdmin = useIsAdmin()
  const [filters, setFilters] = useState<Required<AuditFilters>>(EMPTY_FILTERS)
  const [live, setLive] = useState(false)
  const servers = useServers()
  const users = useQuery({ queryKey: qk.users, queryFn: api.users.list, enabled: isAdmin })

  const audit = useInfiniteQuery({
    queryKey: qk.audit(filters),
    queryFn: ({ pageParam }) => api.audit({ ...filters, limit: PAGE_SIZE, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: live ? 5000 : false,
  })

  const rows = useMemo(() => {
    const seen = new Set<number>()
    const out: AuditEntry[] = []
    for (const p of audit.data?.pages ?? []) {
      for (const e of p.items) {
        if (!seen.has(e.id)) {
          seen.add(e.id)
          out.push(e)
        }
      }
    }
    return out
  }, [audit.data])

  const set = <K extends keyof AuditFilters>(k: K, v: string) => setFilters((f) => ({ ...f, [k]: v }))
  const filtered = Object.values(filters).some(Boolean)

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title="Audit log"
        description={
          isAdmin
            ? 'Every MCP request through the gateway, from every client and teammate.'
            : 'Every MCP request made with your account and keys.'
        }
        actions={
          <>
            <label className="flex items-center gap-2 text-[13px] font-medium text-zinc-600">
              <Switch checked={live} onChange={setLive} label="Auto-refresh every 5 seconds" size="sm" />
              Auto-refresh
              {live && (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
              )}
            </label>
            <Button
              size="sm"
              icon={<RefreshCw className={cn('size-3.5', audit.isFetching && !audit.isFetchingNextPage && 'animate-spin')} />}
              onClick={() => audit.refetch()}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isAdmin && (
          <Select
            aria-label="Filter by user"
            className="w-full sm:w-52"
            value={filters.userId}
            onChange={(e) => set('userId', e.target.value)}
          >
            <option value="">All users</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ? `${u.name} (${u.email})` : u.email}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Filter by server"
          className="w-full sm:w-44"
          value={filters.serverSlug}
          onChange={(e) => set('serverSlug', e.target.value)}
        >
          <option value="">All servers</option>
          {(servers.data ?? []).map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by outcome"
          className="w-full sm:w-40"
          value={filters.outcome}
          onChange={(e) => set('outcome', e.target.value)}
        >
          <option value="">All outcomes</option>
          {(Object.keys(OUTCOME) as AuditOutcome[]).map((o) => (
            <option key={o} value={o}>
              {OUTCOME[o].label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by client"
          className="w-full sm:w-36"
          value={filters.client}
          onChange={(e) => set('client', e.target.value)}
        >
          <option value="">All clients</option>
          <option value="mcp">MCP</option>
          <option value="chat">Chat</option>
        </Select>
        {filtered && (
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>

      <Card>
        {audit.isPending ? (
          <TableSkeleton rows={8} cols={7} />
        ) : audit.isError ? (
          <EmptyState
            icon={<CircleAlert />}
            title="Couldn't load the audit log"
            description={errorMessage(audit.error)}
            action={<Button onClick={() => audit.refetch()}>Retry</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title={filtered ? 'No matching entries' : 'No activity yet'}
            description={
              filtered
                ? 'Try widening the filters.'
                : 'Tool calls from MCP clients and the built-in chat will be recorded here.'
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Time</TH>
                  <TH>User</TH>
                  <TH>Client</TH>
                  <TH>Server</TH>
                  <TH>Tool</TH>
                  <TH className="text-right">Duration</TH>
                  <TH>Outcome</TH>
                  <TH>Error</TH>
                  <TH>Pod</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">
                      <Tooltip content={formatDateTime(e.ts)}>
                        <span className="tabular-nums text-zinc-600">{formatRelative(e.ts)}</span>
                      </Tooltip>
                    </TD>
                    <TD className="max-w-48">
                      <p className="truncate text-zinc-800">{e.userEmail ?? <span className="text-zinc-400">anonymous</span>}</p>
                      {e.keyPrefix && <p className="truncate font-mono text-[11px] text-zinc-400">{e.keyPrefix}…</p>}
                    </TD>
                    <TD>
                      <ClientBadge client={e.client} />
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-[12px] text-zinc-600">{e.serverSlug ?? '–'}</TD>
                    <TD className="max-w-64 truncate">
                      <ToolCell e={e} />
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{formatMs(e.durationMs)}</TD>
                    <TD>
                      <OutcomeBadge outcome={e.outcome} />
                    </TD>
                    <TD className="max-w-56">
                      {e.error ? (
                        <Tooltip content={e.error} wide className="max-w-full">
                          <span className="block truncate text-[12px] text-red-600">{e.error}</span>
                        </Tooltip>
                      ) : (
                        <span className="text-zinc-300">–</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-[11px] text-zinc-400">{e.gatewayPod}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
              <span>
                Showing {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
              </span>
              {audit.hasNextPage ? (
                <Button size="sm" onClick={() => audit.fetchNextPage()} loading={audit.isFetchingNextPage}>
                  Load more
                </Button>
              ) : (
                <span>End of log</span>
              )}
            </div>
          </>
        )}
      </Card>
    </Page>
  )
}
