import type { ReactNode } from 'react'
import { Ban, KeyRound } from 'lucide-react'
import { formatDate, formatDateTime, formatRelative } from '../../lib/format'
import type { ApiKey } from '../../lib/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { TableSkeleton } from '../ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR } from '../ui/Table'
import { Tooltip } from '../ui/Tooltip'

export function KeyTable({
  keys,
  loading,
  showOwner = false,
  onRevoke,
  empty,
}: {
  keys: ApiKey[] | undefined
  loading: boolean
  showOwner?: boolean
  onRevoke: (key: ApiKey) => void
  empty?: ReactNode
}) {
  if (loading) return <TableSkeleton rows={3} cols={showOwner ? 6 : 5} />
  if (!keys || keys.length === 0)
    return (
      empty ?? <EmptyState icon={<KeyRound />} title="No API keys" description="Keys created by your team show up here." />
    )

  const sorted = [...keys].sort(
    (a, b) => Number(Boolean(a.revokedAt)) - Number(Boolean(b.revokedAt)) || b.createdAt.localeCompare(a.createdAt),
  )

  return (
    <Table>
      <THead>
        <tr>
          <TH>Name</TH>
          {showOwner && <TH>Owner</TH>}
          <TH>Key</TH>
          <TH>Created</TH>
          <TH>Last used</TH>
          <TH>Status</TH>
          <TH className="w-px" />
        </tr>
      </THead>
      <TBody>
        {sorted.map((k) => {
          const revoked = Boolean(k.revokedAt)
          return (
            <TR key={k.id} className={revoked ? 'text-zinc-400' : undefined}>
              <TD className={revoked ? 'text-zinc-400' : 'font-medium text-zinc-900'}>{k.name}</TD>
              {showOwner && (
                <TD>
                  {k.user ? (
                    <div className="min-w-0">
                      <p className="truncate text-zinc-800">{k.user.name || k.user.email}</p>
                      {k.user.name && <p className="truncate text-xs text-zinc-500">{k.user.email}</p>}
                    </div>
                  ) : (
                    '–'
                  )}
                </TD>
              )}
              <TD>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[12px] text-zinc-700">{k.prefix}…</code>
              </TD>
              <TD className="whitespace-nowrap">
                <Tooltip content={formatDateTime(k.createdAt)}>
                  <span>{formatDate(k.createdAt)}</span>
                </Tooltip>
              </TD>
              <TD className="whitespace-nowrap">
                {k.lastUsedAt ? (
                  <Tooltip content={formatDateTime(k.lastUsedAt)}>
                    <span>{formatRelative(k.lastUsedAt)}</span>
                  </Tooltip>
                ) : (
                  <span className="text-zinc-400">Never</span>
                )}
              </TD>
              <TD>
                {revoked ? (
                  <Tooltip content={`Revoked ${formatDateTime(k.revokedAt)}`}>
                    <Badge tone="gray">Revoked</Badge>
                  </Tooltip>
                ) : (
                  <Badge tone="green" dot>
                    Active
                  </Badge>
                )}
              </TD>
              <TD className="text-right">
                {!revoked && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                    icon={<Ban className="size-3.5" />}
                    onClick={() => onRevoke(k)}
                  >
                    Revoke
                  </Button>
                )}
              </TD>
            </TR>
          )
        })}
      </TBody>
    </Table>
  )
}
