import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Eye,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { formatMs, formatRelative, prettyJson } from '../lib/format'
import { qk, useIsAdmin, useServers } from '../lib/queries'
import type { Server, Tool } from '../lib/types'
import { Page } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CopyButton } from '../components/ui/CopyButton'
import { EmptyState } from '../components/ui/EmptyState'
import { Input } from '../components/ui/Input'
import { Skeleton } from '../components/ui/Skeleton'
import { Switch } from '../components/ui/Switch'
import { Tabs } from '../components/ui/Tabs'
import { useToast } from '../components/ui/Toast'
import { Tooltip } from '../components/ui/Tooltip'
import { ServerStatusBadge, ToolStatusBadge } from '../components/servers/StatusBadge'
import { ServerFormDialog } from '../components/servers/ServerFormDialog'
import { DefinitionDiff } from '../components/servers/DefinitionDiff'
import { useServerActions } from '../components/servers/useServerActions'

type Filter = 'all' | 'review' | 'active'

const FLAG_LABELS: Record<string, string> = {
  'mentions-other-tools': 'Mentions other tools',
  'instruction-override': 'Instruction override',
}

function flagLabel(flag: string) {
  return FLAG_LABELS[flag] ?? flag.replace(/[-_]/g, ' ')
}

function useToolMutations(serverId: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const key = qk.tools(serverId)

  const replace = (tool: Tool) =>
    queryClient.setQueryData<Tool[]>(key, (list) => list?.map((t) => (t.name === tool.name ? tool : t)))

  const update = useMutation({
    mutationFn: ({ tool, body }: { tool: Tool; body: { enabled?: boolean; minRole?: 'member' | 'admin' } }) =>
      api.servers.updateTool(serverId, tool.name, body),
    onMutate: async ({ tool, body }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const prev = queryClient.getQueryData<Tool[]>(key)
      queryClient.setQueryData<Tool[]>(key, (list) => list?.map((t) => (t.name === tool.name ? { ...t, ...body } : t)))
      return { prev }
    },
    onSuccess: (saved) => replace(saved),
    onError: (err, { tool }, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev)
      toast.error(`Could not update ${tool.exposedName}`, err)
    },
  })

  const approve = useMutation({
    mutationFn: (tool: Tool) => api.servers.approveTool(serverId, tool.name),
    onSuccess: (saved) => {
      replace(saved)
      void queryClient.invalidateQueries({ queryKey: qk.servers })
      toast.success('Tool approved', `${saved.exposedName} is now visible to MCP clients`)
    },
    onError: (err, tool) => toast.error(`Could not approve ${tool.exposedName}`, err),
  })

  return { update, approve }
}

function AnnotationChips({ tool }: { tool: Tool }) {
  const a = tool.annotations
  return (
    <>
      {a?.readOnlyHint === true && (
        <Badge tone="blue" icon={<Eye className="size-3" />}>
          read-only
        </Badge>
      )}
      {a?.destructiveHint === true && a?.readOnlyHint !== true && (
        <Badge tone="red" icon={<TriangleAlert className="size-3" />}>
          destructive
        </Badge>
      )}
      {a?.idempotentHint === true && <Badge tone="gray">idempotent</Badge>}
    </>
  )
}

function ToolRow({ tool, server, isAdmin }: { tool: Tool; server: Server; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const { update, approve } = useToolMutations(server.id)
  const approving = approve.isPending && approve.variables?.name === tool.name
  const needsReview = tool.status !== 'active'
  const longDesc = (tool.description?.length ?? 0) > 220

  return (
    <li
      className={cn(
        'px-4 py-4 sm:px-5',
        tool.status === 'changed' && 'bg-red-50/30',
        tool.status === 'pending' && 'bg-amber-50/30',
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex min-w-0 items-center">
              <code
                className={cn(
                  'truncate font-mono text-[13px] font-medium',
                  tool.enabled ? 'text-zinc-900' : 'text-zinc-400 line-through decoration-zinc-300',
                )}
              >
                {tool.exposedName}
              </code>
              <CopyButton value={tool.exposedName} label="Copy tool name" className="ml-0.5 size-6 opacity-60 hover:opacity-100" />
            </span>
            <ToolStatusBadge status={tool.status} />
            <AnnotationChips tool={tool} />
            {tool.minRole === 'admin' && (
              <Badge tone="indigo" icon={<Lock className="size-3" />}>
                admins only
              </Badge>
            )}
            {!tool.enabled && <Badge tone="gray">disabled</Badge>}
            {tool.flags.map((f) => (
              <Tooltip key={f} content={`Heuristic warning: ${f}`}>
                <Badge tone="amber" icon={<ShieldAlert className="size-3" />}>
                  {flagLabel(f)}
                </Badge>
              </Tooltip>
            ))}
          </div>
          {tool.title && tool.title !== tool.name && <p className="mt-1 text-[13px] font-medium text-zinc-700">{tool.title}</p>}
          <p
            className={cn(
              'mt-1 whitespace-pre-line text-[13px] leading-relaxed text-zinc-600',
              longDesc && !descExpanded && 'line-clamp-2',
            )}
          >
            {tool.description || <span className="italic text-zinc-400">No description</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <Braces className="size-3.5" />
              Input schema
            </button>
            {longDesc && (
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
              >
                {descExpanded ? 'Show less' : 'Show full description'}
              </button>
            )}
            <span className="text-xs text-zinc-400">First seen {formatRelative(tool.firstSeenAt)}</span>
          </div>
        </div>

        {isAdmin && (
          <div className="flex shrink-0 items-center gap-5 md:pt-0.5">
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
              <Switch
                size="sm"
                checked={tool.enabled}
                onChange={(enabled) => update.mutate({ tool, body: { enabled } })}
                label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.exposedName}`}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
              <Switch
                size="sm"
                checked={tool.minRole === 'admin'}
                onChange={(adminOnly) => update.mutate({ tool, body: { minRole: adminOnly ? 'admin' : 'member' } })}
                label={`Restrict ${tool.exposedName} to admins`}
              />
              Admins only
            </label>
          </div>
        )}
      </div>

      {open && (
        <pre className="scroll-thin mt-3 max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-[12px] leading-relaxed text-zinc-200">
          {prettyJson(tool.inputSchema) || '{}'}
        </pre>
      )}

      {needsReview && (
        <div
          className={cn(
            'mt-3 rounded-lg p-3 ring-1 ring-inset',
            tool.status === 'changed' ? 'bg-white ring-red-200' : 'bg-white ring-amber-200',
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              {tool.status === 'changed' ? (
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
              ) : (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
              )}
              <div>
                <p className="text-[13px] font-medium text-zinc-900">
                  {tool.status === 'changed' ? 'Definition changed since approval' : 'New tool awaiting review'}
                </p>
                <p className="text-xs text-zinc-500">
                  {tool.status === 'changed'
                    ? 'Hidden from all clients until re-approved. Check for unexpected instructions or new parameters.'
                    : 'This tool appeared after the server was approved. It stays hidden until an admin approves it.'}
                </p>
              </div>
            </div>
            {isAdmin && (
              <Button
                size="sm"
                variant="primary"
                icon={<ShieldCheck className="size-3.5" />}
                loading={approving}
                onClick={() => approve.mutate(tool)}
              >
                {tool.status === 'changed' ? 'Approve changes' : 'Approve'}
              </Button>
            )}
          </div>
          {tool.status === 'changed' && tool.approvedDefinition && (
            <div className="mt-3">
              <DefinitionDiff
                approved={tool.approvedDefinition}
                current={{ description: tool.description, inputSchema: tool.inputSchema }}
              />
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-zinc-800">{children}</dd>
    </div>
  )
}

export function ServerDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const servers = useServers({ poll: true })
  const server = servers.data?.find((s) => s.id === id)
  const tools = useQuery({
    queryKey: qk.tools(id),
    queryFn: () => api.servers.tools(id),
    enabled: Boolean(server),
    refetchInterval: 15_000,
  })
  const { toggle, refresh } = useServerActions()
  const [editOpen, setEditOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const all = tools.data ?? []
  const reviewCount = all.filter((t) => t.status !== 'active').length
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const order = { changed: 0, pending: 1, active: 2 } as const
    return all
      .filter((t) => (filter === 'review' ? t.status !== 'active' : filter === 'active' ? t.status === 'active' : true))
      .filter((t) => !q || t.exposedName.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
      .sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name))
  }, [all, filter, search])

  if (servers.isPending) {
    return (
      <Page>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-4 h-7 w-64" />
        <Skeleton className="mt-6 h-24 w-full" />
        <Skeleton className="mt-6 h-64 w-full" />
      </Page>
    )
  }

  if (!server) {
    return (
      <Page>
        <Card>
          <EmptyState
            icon={<CircleAlert />}
            title={servers.isError ? "Couldn't load servers" : 'Server not found'}
            description={servers.isError ? errorMessage(servers.error) : 'It may have been removed by an admin.'}
            action={
              <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/servers')}>
                Back to servers
              </Button>
            }
          />
        </Card>
      </Page>
    )
  }

  return (
    <Page>
      <Link to="/servers" className="inline-flex items-center gap-1 text-[13px] font-medium text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-3.5" /> Servers
      </Link>

      <header className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{server.name}</h1>
            <ServerStatusBadge status={server.status} />
            {server.managed && (
              <Badge tone="blue" icon={<Lock className="size-3" />}>
                managed
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-[13px] text-zinc-500">{server.slug}__*</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <label className="mr-2 flex items-center gap-2 text-[13px] font-medium text-zinc-600">
              <Switch
                checked={server.enabled}
                disabled={toggle.isPending}
                onChange={(enabled) => toggle.mutate({ server, enabled })}
                label={server.enabled ? 'Disable server' : 'Enable server'}
              />
              {server.enabled ? 'Enabled' : 'Disabled'}
            </label>
            <Button
              icon={<RefreshCw className={cn('size-4', refresh.isPending && 'animate-spin')} />}
              disabled={refresh.isPending || !server.enabled}
              onClick={() => refresh.mutate(server)}
            >
              Refresh
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          </div>
        )}
      </header>

      {server.status === 'unreachable' && (
        <div className="mb-6 flex items-start gap-3 rounded-xl bg-red-50 px-4 py-3 ring-1 ring-inset ring-red-600/15">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-800">The gateway can't reach this server</p>
            {server.statusReason && <p className="mt-0.5 break-all font-mono text-xs text-red-700">{server.statusReason}</p>}
            <p className="mt-1 text-xs text-red-700/80">Its tools are hidden from MCP clients until it reconnects.</p>
          </div>
        </div>
      )}

      <Card className="mb-6">
        <dl className="grid grid-cols-2 gap-4 px-5 py-4 md:grid-cols-3 lg:grid-cols-6">
          <Meta label="Tools">{server.toolCount}</Meta>
          <Meta label="Needs review">
            <span className={server.pendingReviewCount > 0 ? 'text-amber-700' : undefined}>{server.pendingReviewCount}</span>
          </Meta>
          <Meta label="Auth">
            {server.authType === 'none' ? 'None' : server.authType === 'bearer' ? 'Bearer' : (server.authHeaderName ?? 'Header')}
            {server.authType !== 'none' && !server.hasCredential && isAdmin && (
              <span className="ml-1 text-xs font-normal text-amber-600">(no credential)</span>
            )}
          </Meta>
          <Meta label="Timeout">{formatMs(server.timeoutMs)}</Meta>
          <Meta label="Connected">{server.connectedAt ? formatRelative(server.connectedAt) : '–'}</Meta>
          <Meta label="Last checked">{formatRelative(server.lastCheckedAt)}</Meta>
        </dl>
        {isAdmin && server.url && (
          <div className="flex items-center gap-2 border-t border-zinc-100 px-5 py-2.5">
            <span className="text-xs text-zinc-500">URL</span>
            <code className="min-w-0 truncate font-mono text-xs text-zinc-700">{server.url}</code>
            <CopyButton value={server.url} label="Copy URL" />
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-3">
          <Tabs<Filter>
            className="border-b-0"
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: 'All tools', count: all.length },
              { id: 'review', label: 'Needs review', count: reviewCount },
              { id: 'active', label: 'Active', count: all.length - reviewCount },
            ]}
          />
          <div className="relative mb-2 w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter tools…"
              className="h-8 pl-8"
              aria-label="Filter tools"
            />
          </div>
        </div>
        <div className="border-t border-zinc-200/80">
          {tools.isPending ? (
            <div className="space-y-5 p-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-full max-w-lg" />
                </div>
              ))}
            </div>
          ) : tools.isError ? (
            <EmptyState
              icon={<CircleAlert />}
              title="Couldn't load tools"
              description={errorMessage(tools.error)}
              action={<Button onClick={() => tools.refetch()}>Retry</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Wrench />}
              title={all.length === 0 ? 'No tools discovered' : 'No matching tools'}
              description={
                all.length === 0
                  ? server.status === 'connected'
                    ? 'The server is connected but reported no tools.'
                    : 'Tools are listed once the gateway connects to this server.'
                  : filter === 'review'
                    ? 'Nothing waiting for review. Nice.'
                    : 'Try a different search.'
              }
            />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {filtered.map((t) => (
                <ToolRow key={t.name} tool={t} server={server} isAdmin={isAdmin} />
              ))}
            </ul>
          )}
        </div>
      </Card>

      {isAdmin && <ServerFormDialog open={editOpen} onClose={() => setEditOpen(false)} server={server} />}
    </Page>
  )
}
