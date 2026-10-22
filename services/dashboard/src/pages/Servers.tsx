import { useState } from 'react'
import { Link } from 'react-router'
import {
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Server as ServerIcon,
  ShieldAlert,
  Trash,
  Wrench,
} from 'lucide-react'
import { errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { formatRelative } from '../lib/format'
import { useIsAdmin, useServers } from '../lib/queries'
import type { Server } from '../lib/types'
import { Page, PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/Dialog'
import { EmptyState } from '../components/ui/EmptyState'
import { Menu } from '../components/ui/Menu'
import { Skeleton } from '../components/ui/Skeleton'
import { Switch } from '../components/ui/Switch'
import { Tooltip } from '../components/ui/Tooltip'
import { ServerStatusBadge } from '../components/servers/StatusBadge'
import { ServerFormDialog } from '../components/servers/ServerFormDialog'
import { useServerActions } from '../components/servers/useServerActions'

function authLabel(s: Server) {
  if (s.authType === 'bearer') return 'Bearer token'
  if (s.authType === 'header') return s.authHeaderName ? `Header ${s.authHeaderName}` : 'Custom header'
  return 'No auth'
}

function ServerCard({
  server,
  isAdmin,
  onEdit,
  onRemove,
}: {
  server: Server
  isAdmin: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  const { toggle, refresh } = useServerActions()
  const refreshing = refresh.isPending && refresh.variables?.id === server.id
  const toggling = toggle.isPending && toggle.variables?.server.id === server.id

  return (
    <Card className="group relative flex flex-col transition-shadow hover:shadow-md hover:shadow-zinc-950/5">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
            server.status === 'connected' && 'bg-emerald-50 text-emerald-600 ring-emerald-600/15',
            server.status === 'unreachable' && 'bg-red-50 text-red-600 ring-red-600/15',
            server.status === 'connecting' && 'bg-amber-50 text-amber-600 ring-amber-600/20',
            server.status === 'disabled' && 'bg-zinc-100 text-zinc-400 ring-zinc-500/10',
          )}
        >
          <ServerIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              to={`/servers/${server.id}`}
              className="truncate text-sm font-semibold text-zinc-900 after:absolute after:inset-0 after:content-[''] hover:text-indigo-600"
            >
              {server.name}
            </Link>
            {server.managed && (
              <Tooltip content="Registered by the Helm bootstrap config" className="relative z-10">
                <Badge tone="blue" icon={<Lock className="size-3" />}>
                  managed
                </Badge>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{server.slug}</p>
        </div>
        {isAdmin && (
          <div className="relative z-10 flex items-center gap-1">
            <Switch
              size="sm"
              checked={server.enabled}
              disabled={toggling}
              onChange={(enabled) => toggle.mutate({ server, enabled })}
              label={server.enabled ? `Disable ${server.name}` : `Enable ${server.name}`}
            />
            <Menu
              label={`Actions for ${server.name}`}
              trigger={<Ellipsis className="size-4" />}
              items={[
                { label: 'Edit', icon: <Pencil />, onSelect: onEdit },
                {
                  label: 'Refresh tools',
                  icon: <RefreshCw />,
                  onSelect: () => refresh.mutate(server),
                  disabled: !server.enabled || refreshing,
                },
                { label: 'Remove', icon: <Trash />, onSelect: onRemove, danger: true, separatorBefore: true },
              ]}
            />
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2.5 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <ServerStatusBadge status={server.status} />
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <Wrench className="size-3.5 text-zinc-400" />
            {server.toolCount} tool{server.toolCount === 1 ? '' : 's'}
          </span>
          {isAdmin && <span className="text-xs text-zinc-400">· {authLabel(server)}</span>}
        </div>

        {server.status === 'unreachable' && server.statusReason && (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2 py-1.5 font-mono text-[11.5px] leading-snug text-red-700 ring-1 ring-inset ring-red-600/10">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2 break-all">{server.statusReason}</span>
          </p>
        )}

        {server.pendingReviewCount > 0 && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <ShieldAlert className="size-3.5" />
            {server.pendingReviewCount} tool{server.pendingReviewCount === 1 ? ' needs' : 's need'} review
          </p>
        )}

        {isAdmin && server.url && (
          <p className="truncate font-mono text-[11.5px] text-zinc-400" title={server.url}>
            {server.url}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
        <span>
          {server.lastCheckedAt ? `Checked ${formatRelative(server.lastCheckedAt)}` : 'Not checked yet'}
          {refreshing && ' · refreshing…'}
        </span>
        <ChevronRight className="size-4 text-zinc-300 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-500" />
      </div>
    </Card>
  )
}

export function ServersPage() {
  const isAdmin = useIsAdmin()
  const servers = useServers({ poll: true })
  const { remove } = useServerActions()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Server | undefined>()
  const [removing, setRemoving] = useState<Server | null>(null)

  // Keep the API's order: Helm-managed servers first, in registration order (WooCommerce is #1).
  const list = servers.data ?? []
  const editingLive = editing ? (servers.data?.find((s) => s.id === editing.id) ?? editing) : undefined

  return (
    <Page>
      <PageHeader
        title="Servers"
        description={
          isAdmin
            ? 'Upstream MCP servers behind the gateway. Status refreshes every 5 seconds.'
            : 'MCP servers your team has connected. Ask an admin to add or change servers.'
        }
        actions={
          isAdmin && (
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
            >
              Add server
            </Button>
          )
        }
      />

      {servers.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex gap-3">
                <Skeleton className="size-9" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-full" />
            </Card>
          ))}
        </div>
      ) : servers.isError ? (
        <Card>
          <EmptyState
            icon={<CircleAlert />}
            title="Couldn't load servers"
            description={errorMessage(servers.error)}
            action={<Button onClick={() => servers.refetch()}>Retry</Button>}
          />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ServerIcon />}
            title="No MCP servers yet"
            description={
              isAdmin
                ? 'Add your first upstream server — for example the WooCommerce MCP server — and its tools become available to everyone through one gateway URL.'
                : 'Once an admin connects an MCP server, its tools will show up here.'
            }
            action={
              isAdmin && (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setFormOpen(true)}>
                  Add server
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <ServerCard
              key={s.id}
              server={s}
              isAdmin={isAdmin}
              onEdit={() => {
                setEditing(s)
                setFormOpen(true)
              }}
              onRemove={() => setRemoving(s)}
            />
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <ServerFormDialog open={formOpen} onClose={() => setFormOpen(false)} server={editingLive} />
          <ConfirmDialog
            open={removing !== null}
            onClose={() => setRemoving(null)}
            pending={remove.isPending}
            title={`Remove ${removing?.name ?? 'server'}?`}
            confirmLabel="Remove server"
            description={
              <>
                Its {removing?.toolCount ?? 0} tools disappear from every MCP client immediately. Audit history is kept.
                {removing?.managed && ' This server is managed by Helm and may be re-created on the next deploy.'}
              </>
            }
            onConfirm={() =>
              removing &&
              remove.mutate(removing, {
                onSuccess: () => setRemoving(null),
              })
            }
          />
        </>
      )}
    </Page>
  )
}
