import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, CircleAlert, Gauge, Plug, RefreshCw, Wrench } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { errorRateOf, formatMs, formatNumber, formatPercent, toPercent } from '../lib/format'
import { qk, useServers } from '../lib/queries'
import { Page, PageHeader } from '../components/layout/PageHeader'
import { Card, CardHeader } from '../components/ui/Card'
import { Segmented } from '../components/ui/Tabs'
import { Skeleton, TableSkeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { CallsChart, ChartLegend, fillHourly } from '../components/charts/CallsChart'

type Window = '24' | '168'

function StatCard({
  label,
  value,
  sub,
  icon,
  loading,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon: ReactNode
  loading?: boolean
  tone?: 'warn' | 'bad'
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-zinc-500">{label}</p>
        <span className="text-zinc-400 [&_svg]:size-4">{icon}</span>
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-7 w-24" />
          <Skeleton className="mt-2 h-3 w-32" />
        </>
      ) : (
        <>
          <p
            className={cn(
              'mt-2 text-2xl font-semibold tracking-tight tabular-nums text-zinc-900',
              tone === 'warn' && 'text-amber-600',
              tone === 'bad' && 'text-red-600',
            )}
          >
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
        </>
      )}
    </Card>
  )
}

export function OverviewPage() {
  const [win, setWin] = useState<Window>('24')
  const hours = Number(win)
  const stats = useQuery({
    queryKey: qk.stats(hours),
    queryFn: () => api.stats(hours),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })
  const servers = useServers()

  const timeline = useMemo(() => fillHourly(stats.data?.timeline ?? [], hours), [stats.data, hours])
  const totals = stats.data?.totals
  const connected = servers.data?.filter((s) => s.status === 'connected').length ?? 0
  const enabledCount = servers.data?.filter((s) => s.enabled).length ?? 0
  const totalServers = servers.data?.length ?? 0
  const errorPct = totals ? toPercent(totals.errorRate) : 0
  const maxTool = Math.max(1, ...(stats.data?.topTools ?? []).map((t) => t.calls))
  const loading = stats.isPending
  const windowLabel = hours === 24 ? 'last 24 hours' : 'last 7 days'

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={`Traffic through the gateway over the ${windowLabel}.`}
        actions={
          <>
            {stats.isFetching && !stats.isPending && <RefreshCw className="size-3.5 animate-spin text-zinc-400" aria-label="Refreshing" />}
            <Segmented<Window>
              value={win}
              onChange={setWin}
              items={[
                { id: '24', label: '24h' },
                { id: '168', label: '7d' },
              ]}
            />
          </>
        }
      />

      {stats.isError && (
        <Card className="mb-6 flex items-center justify-between gap-3 border-red-200 bg-red-50/50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-red-700">
            <CircleAlert className="size-4" /> Couldn't load stats: {errorMessage(stats.error)}
          </p>
          <Button size="sm" onClick={() => stats.refetch()}>
            Retry
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tool calls"
          icon={<Activity />}
          loading={loading}
          value={formatNumber(totals?.calls)}
          sub={windowLabel}
        />
        <StatCard
          label="Error rate"
          icon={<CircleAlert />}
          loading={loading}
          value={formatPercent(totals?.errorRate)}
          tone={errorPct >= 10 ? 'bad' : errorPct >= 2 ? 'warn' : undefined}
          sub={`${formatNumber(totals?.errors)} failed call${totals?.errors === 1 ? '' : 's'}`}
        />
        <StatCard
          label="p95 latency"
          icon={<Gauge />}
          loading={loading}
          value={formatMs(totals?.p95Ms)}
          sub={`p50 ${formatMs(totals?.p50Ms)}`}
        />
        <StatCard
          label="Connected servers"
          icon={<Plug />}
          loading={servers.isPending}
          value={
            <>
              {connected}
              <span className="text-base font-medium text-zinc-400"> / {totalServers}</span>
            </>
          }
          tone={enabledCount > 0 && connected < enabledCount ? 'warn' : undefined}
          sub={
            enabledCount > connected ? (
              <Link to="/servers" className="text-amber-700 hover:underline">
                {enabledCount - connected} enabled server{enabledCount - connected === 1 ? '' : 's'} not connected
              </Link>
            ) : totalServers === 0 ? (
              'No servers registered yet'
            ) : (
              'All enabled servers healthy'
            )
          }
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Calls per hour" description="Successful calls and errors, hourly buckets." actions={<ChartLegend />} />
        <div className="px-3 pb-3 pt-4 sm:px-5">
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : (totals?.calls ?? 0) === 0 ? (
            <EmptyState
              className="h-[220px] py-0"
              icon={<Activity />}
              title="No traffic yet"
              description={
                <>
                  Connect Claude Code, Cursor or the MCP Inspector with an{' '}
                  <Link to="/keys" className="font-medium text-indigo-600 hover:underline">
                    API key
                  </Link>
                  , or try the built-in chat.
                </>
              }
            />
          ) : (
            <CallsChart data={timeline} hours={hours} />
          )}
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="By server" description="Calls routed to each upstream MCP server." />
          {loading ? (
            <TableSkeleton rows={3} cols={4} />
          ) : (stats.data?.perServer.length ?? 0) === 0 ? (
            <EmptyState className="py-10" title="No calls recorded" description="Per-server numbers appear after the first tool call." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Server</TH>
                  <TH className="text-right">Calls</TH>
                  <TH className="text-right">Errors</TH>
                  <TH className="text-right">Error rate</TH>
                  <TH className="text-right">p95</TH>
                </tr>
              </THead>
              <TBody>
                {[...(stats.data?.perServer ?? [])]
                  .sort((a, b) => b.calls - a.calls)
                  .map((s) => {
                    const server = servers.data?.find((x) => x.slug === s.serverSlug)
                    const rate = errorRateOf(s.calls, s.errors)
                    return (
                      <TR key={s.serverSlug}>
                        <TD>
                          {server ? (
                            <Link to={`/servers/${server.id}`} className="group">
                              <span className="font-medium text-zinc-900 group-hover:text-indigo-600">{server.name}</span>
                              <span className="ml-2 font-mono text-xs text-zinc-400">{s.serverSlug}</span>
                            </Link>
                          ) : (
                            <span className="font-mono text-[12.5px] text-zinc-800">{s.serverSlug}</span>
                          )}
                        </TD>
                        <TD className="text-right tabular-nums">{formatNumber(s.calls)}</TD>
                        <TD className={cn('text-right tabular-nums', s.errors > 0 && 'text-red-600')}>{formatNumber(s.errors)}</TD>
                        <TD className="text-right tabular-nums text-zinc-500">{formatPercent(rate)}</TD>
                        <TD className="text-right tabular-nums">{formatMs(s.p95Ms)}</TD>
                      </TR>
                    )
                  })}
              </TBody>
            </Table>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Top tools" description="Most-called tools in this window." />
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : (stats.data?.topTools.length ?? 0) === 0 ? (
            <EmptyState className="py-10" icon={<Wrench />} title="No tool calls yet" />
          ) : (
            <ol className="space-y-3 px-5 py-4">
              {stats.data!.topTools.slice(0, 8).map((t, i) => (
                <li key={t.exposedName}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-zinc-400">{i + 1}</span>
                      <span className="truncate font-mono text-[12.5px] text-zinc-800" title={t.exposedName}>
                        {t.exposedName}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-zinc-900">{formatNumber(t.calls)}</span>
                  </div>
                  <div className="ml-6 mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(t.calls / maxTool) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </Page>
  )
}
