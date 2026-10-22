import { useState } from 'react'
import { Terminal } from 'lucide-react'
import { useInfo } from '../../lib/queries'
import { Card, CardHeader } from '../ui/Card'
import { CodeBlock, CopyField } from '../ui/CopyButton'
import { Skeleton } from '../ui/Skeleton'
import { Tabs } from '../ui/Tabs'

type Client = 'claude' | 'cursor' | 'inspector'

const PLACEHOLDER = '<YOUR_KEY>'

export function ConnectSnippets({ secret }: { secret?: string }) {
  const info = useInfo()
  const [client, setClient] = useState<Client>('claude')
  const key = secret ?? PLACEHOLDER
  const mcpUrl = info.data?.mcpUrl ?? `${window.location.origin}/mcp`

  const claude = `claude mcp add --transport http urumi ${mcpUrl} --header "Authorization: Bearer ${key}"`
  const cursor = JSON.stringify(
    { mcpServers: { urumi: { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  )

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Terminal className="size-4 text-zinc-400" /> Connect your MCP client
          </span>
        }
        description={
          secret
            ? 'Your new key is filled in below — copy a snippet now, it won’t be shown again.'
            : `Replace ${PLACEHOLDER} with one of your API keys. Tools are named ${info.data?.toolNaming ?? '<server>__<tool>'}.`
        }
      />
      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-500">Gateway MCP endpoint</p>
          {info.isPending ? <Skeleton className="h-9 w-full" /> : <CopyField value={mcpUrl} />}
        </div>

        <Tabs<Client>
          value={client}
          onChange={setClient}
          items={[
            { id: 'claude', label: 'Claude Code' },
            { id: 'cursor', label: 'Cursor' },
            { id: 'inspector', label: 'MCP Inspector' },
          ]}
        />

        {client === 'claude' && (
          <div className="space-y-2">
            <p className="text-[13px] text-zinc-600">Run this in your terminal, then start Claude Code and type <code className="rounded bg-zinc-100 px-1 font-mono text-xs">/mcp</code> to check the connection.</p>
            <CodeBlock title="bash" code={claude} />
          </div>
        )}

        {client === 'cursor' && (
          <div className="space-y-2">
            <p className="text-[13px] text-zinc-600">
              Add this to <code className="rounded bg-zinc-100 px-1 font-mono text-xs">~/.cursor/mcp.json</code> (or{' '}
              <code className="rounded bg-zinc-100 px-1 font-mono text-xs">.cursor/mcp.json</code> in a project), then reload
              Cursor.
            </p>
            <CodeBlock title="~/.cursor/mcp.json" code={cursor} />
          </div>
        )}

        {client === 'inspector' && (
          <div className="space-y-3">
            <p className="text-[13px] text-zinc-600">
              Start it with <code className="rounded bg-zinc-100 px-1 font-mono text-xs">npx @modelcontextprotocol/inspector</code>{' '}
              and fill in:
            </p>
            <dl className="divide-y divide-zinc-100 overflow-hidden rounded-lg ring-1 ring-zinc-200">
              {[
                ['Transport Type', 'Streamable HTTP'],
                ['URL', mcpUrl],
                ['Header name', 'Authorization'],
                ['Header value', `Bearer ${key}`],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-4">
                  <dt className="w-32 shrink-0 text-xs font-medium text-zinc-500">{label}</dt>
                  <dd className="min-w-0 flex-1">
                    <CopyField value={value!} className="bg-white" />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </Card>
  )
}
