import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, TriangleAlert, X } from 'lucide-react'
import { api } from '../lib/api'
import { qk } from '../lib/queries'
import type { ApiKey } from '../lib/types'
import { Page, PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { ConfirmDialog, Dialog } from '../components/ui/Dialog'
import { CopyButton } from '../components/ui/CopyButton'
import { EmptyState } from '../components/ui/EmptyState'
import { Field, Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { ConnectSnippets } from '../components/keys/ConnectSnippets'
import { KeyTable } from '../components/keys/KeyTable'
import { useRevokeKey } from '../components/keys/useRevokeKey'

export function SecretReveal({ secret }: { secret: string }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-indigo-50/70 p-3 ring-1 ring-inset ring-indigo-200">
        <p className="mb-2 text-xs font-medium text-indigo-900">Your new API key</p>
        <div className="flex items-center gap-2 rounded-lg bg-white py-1.5 pl-3 pr-1.5 ring-1 ring-indigo-200">
          <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-zinc-900">{secret}</code>
          <CopyButton value={secret} label="Copy key" showLabel className="text-indigo-700 hover:bg-indigo-50" />
        </div>
      </div>
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800 ring-1 ring-inset ring-amber-600/20">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        Copy it now and store it somewhere safe. For security, it will never be shown again — if you lose it, revoke it and
        create a new one.
      </p>
    </div>
  )
}

function CreateKeyDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (r: { key: ApiKey; secret: string }) => void
}) {
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ key: ApiKey; secret: string } | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const create = useMutation({
    mutationFn: () => api.keys.create(name.trim()),
    onSuccess: (r) => {
      setCreated(r)
      onCreated(r)
      queryClient.setQueryData<ApiKey[]>(qk.myKeys, (list) => (list ? [r.key, ...list] : list))
      void queryClient.invalidateQueries({ queryKey: ['keys'] })
    },
    onError: (err) => toast.error('Could not create key', err),
  })

  const close = () => {
    onClose()
    // Let the exit happen before clearing so the secret doesn't flash away.
    window.setTimeout(() => {
      setName('')
      setCreated(null)
      create.reset()
    }, 150)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      dismissable={!create.isPending}
      title={created ? 'API key created' : 'Create API key'}
      description={
        created
          ? `“${created.key.name}” is ready. Use it as a Bearer token from any MCP client.`
          : 'Keys act as you: MCP clients using this key get exactly your role and tool access, and every call is audited.'
      }
      footer={
        created ? (
          <Button variant="primary" onClick={close}>
            I've saved my key
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={create.isPending}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="create-key" loading={create.isPending} disabled={!name.trim()}>
              Create key
            </Button>
          </>
        )
      }
    >
      {created ? (
        <SecretReveal secret={created.secret} />
      ) : (
        <form id="create-key" onSubmit={onSubmit}>
          <Field label="Name" htmlFor="key-name" hint="Something to recognise it by, e.g. “Laptop – Claude Code”.">
            <Input
              id="key-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Laptop – Claude Code"
            />
          </Field>
        </form>
      )}
    </Dialog>
  )
}

export function KeysPage() {
  const keys = useQuery({ queryKey: qk.myKeys, queryFn: api.keys.mine })
  const revoke = useRevokeKey()
  const [createOpen, setCreateOpen] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [fresh, setFresh] = useState<{ key: ApiKey; secret: string } | null>(null)
  const activeCount = keys.data?.filter((k) => !k.revokedAt).length ?? 0

  return (
    <Page>
      <PageHeader
        title="API keys"
        description="Personal keys for connecting MCP clients to the gateway."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader
            title="My keys"
            description={keys.data ? `${activeCount} active key${activeCount === 1 ? '' : 's'}` : undefined}
          />
          <KeyTable
            keys={keys.data}
            loading={keys.isPending}
            onRevoke={setRevoking}
            empty={
              <EmptyState
                icon={<KeyRound />}
                title="You don't have any API keys yet"
                description="Create a key to use the gateway from Claude Code, Cursor or any MCP client."
                action={
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreateOpen(true)}>
                    Create your first key
                  </Button>
                }
              />
            }
          />
        </Card>

        {fresh && (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-indigo-50 px-4 py-3 text-[13px] text-indigo-900 ring-1 ring-inset ring-indigo-200">
            <p>
              The snippets below include your new key <span className="font-medium">“{fresh.key.name}”</span>. It disappears
              when you leave this page.
            </p>
            <button
              type="button"
              onClick={() => setFresh(null)}
              className="rounded p-0.5 text-indigo-500 hover:bg-indigo-100 hover:text-indigo-800"
              aria-label="Remove key from snippets"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <ConnectSnippets secret={fresh?.secret} />
      </div>

      <CreateKeyDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={setFresh} />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        pending={revoke.isPending}
        title="Revoke API key?"
        confirmLabel="Revoke key"
        description={
          <>
            <span className="font-medium text-zinc-700">{revoking?.name}</span> (
            <code className="font-mono text-xs">{revoking?.prefix}…</code>) will stop working immediately. Any MCP client
            using it will be disconnected. This can't be undone.
          </>
        }
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking, {
            onSuccess: () => {
              if (fresh?.key.id === revoking.id) setFresh(null)
              setRevoking(null)
            },
          })
        }
      />
    </Page>
  )
}
