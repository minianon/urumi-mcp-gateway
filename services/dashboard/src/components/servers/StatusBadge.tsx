import type { ServerStatus, ToolStatus } from '../../lib/types'
import { Badge, type Tone } from '../ui/Badge'

const SERVER: Record<ServerStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  connected: { tone: 'green', label: 'Connected' },
  unreachable: { tone: 'red', label: 'Unreachable' },
  disabled: { tone: 'gray', label: 'Disabled' },
  connecting: { tone: 'amber', label: 'Connecting', pulse: true },
}

export function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const s = SERVER[status] ?? { tone: 'gray' as Tone, label: status }
  return (
    <Badge tone={s.tone} dot pulse={s.pulse}>
      {s.label}
    </Badge>
  )
}

const TOOL: Record<ToolStatus, { tone: Tone; label: string }> = {
  active: { tone: 'green', label: 'Active' },
  pending: { tone: 'amber', label: 'Pending review' },
  changed: { tone: 'red', label: 'Changed' },
}

export function ToolStatusBadge({ status }: { status: ToolStatus }) {
  const s = TOOL[status] ?? { tone: 'gray' as Tone, label: status }
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  )
}
