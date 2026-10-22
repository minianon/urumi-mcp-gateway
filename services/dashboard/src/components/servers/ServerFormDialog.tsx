import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, Info, Plug } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { slugify } from '../../lib/format'
import { qk } from '../../lib/queries'
import type { AuthType, Server, ServerInput, ServerPatch, ServerTestResult } from '../../lib/types'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Field, Input, Select } from '../ui/Input'
import { Switch } from '../ui/Switch'
import { useToast } from '../ui/Toast'

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const DEFAULT_TIMEOUT = 30_000

interface FormState {
  name: string
  slug: string
  slugTouched: boolean
  url: string
  authType: AuthType
  authHeaderName: string
  credential: string
  clearCredential: boolean
  timeoutMs: string
  enabled: boolean
}

function initialState(server?: Server): FormState {
  return {
    name: server?.name ?? '',
    slug: server?.slug ?? '',
    slugTouched: Boolean(server),
    url: server?.url ?? '',
    authType: server?.authType ?? 'none',
    authHeaderName: server?.authHeaderName ?? '',
    credential: '',
    clearCredential: false,
    timeoutMs: String(server?.timeoutMs ?? DEFAULT_TIMEOUT),
    enabled: server?.enabled ?? true,
  }
}

function validate(f: FormState) {
  const errors: Partial<Record<'name' | 'slug' | 'url' | 'authHeaderName' | 'timeoutMs', string>> = {}
  if (!f.name.trim()) errors.name = 'Name is required.'
  if (!f.slug) errors.slug = 'Slug is required.'
  else if (!SLUG_RE.test(f.slug) || f.slug.includes('--'))
    errors.slug = 'Lowercase letters, numbers and single dashes only.'
  try {
    const u = new URL(f.url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') errors.url = 'Must be an http(s) URL.'
  } catch {
    errors.url = 'Enter a full URL, e.g. http://woo-mcp.store.svc:3000/mcp'
  }
  if (f.authType === 'header' && !/^[A-Za-z0-9-]+$/.test(f.authHeaderName.trim()))
    errors.authHeaderName = 'Enter a valid header name, e.g. X-API-Key.'
  const t = Number(f.timeoutMs)
  if (!Number.isInteger(t) || t < 100 || t > 600_000) errors.timeoutMs = 'Between 100 and 600000 ms.'
  return errors
}

export function ServerFormDialog({ open, onClose, server }: { open: boolean; onClose: () => void; server?: Server }) {
  const editing = Boolean(server)
  const [f, setF] = useState<FormState>(() => initialState(server))
  const [submitted, setSubmitted] = useState(false)
  const [testResult, setTestResult] = useState<ServerTestResult | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Reset only when the dialog opens (or targets another server) — not on every 5s poll of the list.
  const serverId = server?.id
  useEffect(() => {
    if (open) {
      setF(initialState(server))
      setSubmitted(false)
      setTestResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, serverId])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setF((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'name' && !prev.slugTouched) next.slug = slugify(String(value))
      return next
    })
    setTestResult(null)
  }

  const errors = validate(f)
  const valid = Object.keys(errors).length === 0
  const showErr = (k: keyof typeof errors) => (submitted || (k === 'slug' && f.slugTouched) ? errors[k] : undefined)

  const toInput = (): ServerInput => ({
    name: f.name.trim(),
    slug: f.slug,
    url: f.url.trim(),
    authType: f.authType,
    ...(f.authType === 'header' ? { authHeaderName: f.authHeaderName.trim() } : {}),
    ...(f.authType !== 'none' && f.credential ? { credential: f.credential } : {}),
    timeoutMs: Number(f.timeoutMs),
    enabled: f.enabled,
  })

  const test = useMutation({
    mutationFn: () => api.servers.test(toInput()),
    onSuccess: (r) => setTestResult(r),
    onError: (err) => setTestResult({ ok: false, error: errorMessage(err) }),
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!server) return api.servers.create(toInput())
      const input = toInput()
      const body: ServerPatch = { ...input }
      delete body.credential
      if (f.authType === 'none') {
        if (server.hasCredential) body.credential = null
      } else if (f.clearCredential) {
        body.credential = null
      } else if (f.credential) {
        body.credential = f.credential
      }
      return api.servers.update(server.id, body)
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Server[]>(qk.servers, (list) =>
        list ? (editing ? list.map((s) => (s.id === saved.id ? saved : s)) : [...list, saved]) : list,
      )
      void queryClient.invalidateQueries({ queryKey: qk.servers })
      toast.success(editing ? 'Server updated' : 'Server added', editing ? saved.name : `${saved.name} is connecting…`)
      onClose()
    },
    onError: (err) => toast.error(editing ? 'Could not update server' : 'Could not add server', err),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (valid) save.mutate()
  }

  const credentialUnchanged = editing && server?.hasCredential && !f.credential && !f.clearCredential
  const credentialLabel = f.authType === 'bearer' ? 'Bearer token' : 'Header value'

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      dismissable={!save.isPending}
      title={editing ? `Edit ${server?.name}` : 'Add MCP server'}
      description={
        editing
          ? 'Changes apply to every team member immediately.'
          : 'Register an upstream MCP server (Streamable HTTP). Its tools are exposed through the gateway as slug__tool.'
      }
      footer={
        <>
          <Button
            variant="secondary"
            className="mr-auto"
            icon={<Plug className="size-4" />}
            onClick={() => {
              setSubmitted(true)
              if (valid) test.mutate()
            }}
            loading={test.isPending}
          >
            Test connection
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="server-form" loading={save.isPending}>
            {editing ? 'Save changes' : 'Add server'}
          </Button>
        </>
      }
    >
      <form id="server-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        {server?.managed && (
          <div className="flex gap-2 rounded-lg bg-sky-50 px-3 py-2.5 text-[13px] text-sky-800 ring-1 ring-inset ring-sky-600/15">
            <Info className="mt-0.5 size-4 shrink-0" />
            This server is managed by the Helm bootstrap config. Edits made here may be overwritten on the next deploy.
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="srv-name" error={showErr('name')}>
            <Input
              id="srv-name"
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="WooCommerce Store"
              aria-invalid={Boolean(showErr('name'))}
            />
          </Field>
          <Field
            label="Slug"
            htmlFor="srv-slug"
            error={showErr('slug')}
            hint={
              <>
                Tools appear as <span className="font-mono text-zinc-700">{f.slug || 'slug'}__tool_name</span>
              </>
            }
          >
            <Input
              id="srv-slug"
              className="font-mono text-[13px]"
              value={f.slug}
              onChange={(e) => {
                setF((prev) => ({ ...prev, slug: e.target.value.toLowerCase(), slugTouched: true }))
                setTestResult(null)
              }}
              placeholder="woocommerce"
              aria-invalid={Boolean(showErr('slug'))}
            />
          </Field>
        </div>

        <Field label="URL" htmlFor="srv-url" error={showErr('url')} hint="Streamable HTTP endpoint of the MCP server, usually ending in /mcp.">
          <Input
            id="srv-url"
            className="font-mono text-[13px]"
            value={f.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="http://woo-mcp.store.svc.cluster.local:3000/mcp"
            aria-invalid={Boolean(showErr('url'))}
            spellCheck={false}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Authentication" htmlFor="srv-auth">
            <Select id="srv-auth" value={f.authType} onChange={(e) => set('authType', e.target.value as AuthType)}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="header">Custom header</option>
            </Select>
          </Field>
          {f.authType === 'header' ? (
            <Field label="Header name" htmlFor="srv-header" error={showErr('authHeaderName')}>
              <Input
                id="srv-header"
                className="font-mono text-[13px]"
                value={f.authHeaderName}
                onChange={(e) => set('authHeaderName', e.target.value)}
                placeholder="X-API-Key"
                aria-invalid={Boolean(showErr('authHeaderName'))}
              />
            </Field>
          ) : (
            <Field label="Timeout (ms)" htmlFor="srv-timeout" error={showErr('timeoutMs')}>
              <Input
                id="srv-timeout"
                type="number"
                min={100}
                step={1000}
                value={f.timeoutMs}
                onChange={(e) => set('timeoutMs', e.target.value)}
                aria-invalid={Boolean(showErr('timeoutMs'))}
              />
            </Field>
          )}
        </div>

        {f.authType !== 'none' && (
          <Field
            label={credentialLabel}
            htmlFor="srv-cred"
            hint="Stored encrypted on the gateway and never shown again."
            aside={
              editing && server?.hasCredential ? (
                <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                  <input
                    type="checkbox"
                    className="size-3.5 rounded border-zinc-300 accent-indigo-600"
                    checked={f.clearCredential}
                    onChange={(e) => {
                      setF((prev) => ({ ...prev, clearCredential: e.target.checked, credential: '' }))
                      setTestResult(null)
                    }}
                  />
                  Clear stored credential
                </label>
              ) : undefined
            }
          >
            <Input
              id="srv-cred"
              type="password"
              autoComplete="new-password"
              className="font-mono text-[13px]"
              value={f.credential}
              disabled={f.clearCredential}
              onChange={(e) => set('credential', e.target.value)}
              placeholder={
                f.clearCredential
                  ? 'Credential will be removed'
                  : editing && server?.hasCredential
                    ? '•••••• (unchanged)'
                    : 'Paste token'
              }
            />
          </Field>
        )}

        {f.authType === 'header' && (
          <Field label="Timeout (ms)" htmlFor="srv-timeout2" error={showErr('timeoutMs')} className="sm:w-1/2 sm:pr-2">
            <Input
              id="srv-timeout2"
              type="number"
              min={100}
              step={1000}
              value={f.timeoutMs}
              onChange={(e) => set('timeoutMs', e.target.value)}
              aria-invalid={Boolean(showErr('timeoutMs'))}
            />
          </Field>
        )}

        {!editing && (
          <div className="flex items-center justify-between rounded-lg px-3 py-2.5 ring-1 ring-inset ring-zinc-200">
            <div>
              <p className="text-[13px] font-medium text-zinc-800">Enable immediately</p>
              <p className="text-xs text-zinc-500">Connect now and expose its tools to the team.</p>
            </div>
            <Switch checked={f.enabled} onChange={(v) => set('enabled', v)} label="Enable server" />
          </div>
        )}

        {credentialUnchanged && f.authType !== 'none' && (
          <p className="flex items-start gap-1.5 text-xs text-zinc-500">
            <Info className="mt-px size-3.5 shrink-0" />
            The stored credential is never sent back to the browser, so “Test connection” only uses a credential typed
            above. Save and use Refresh to test with the stored one.
          </p>
        )}

        {testResult && (
          <div
            role="status"
            className={
              testResult.ok
                ? 'rounded-lg bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-600/15'
                : 'rounded-lg bg-red-50 px-3 py-2.5 ring-1 ring-inset ring-red-600/15'
            }
          >
            <p className={testResult.ok ? 'flex items-center gap-2 text-[13px] font-medium text-emerald-800' : 'flex items-center gap-2 text-[13px] font-medium text-red-700'}>
              {testResult.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
              {testResult.ok
                ? `Connected · ${testResult.toolCount ?? testResult.tools?.length ?? 0} tools found`
                : 'Connection failed'}
            </p>
            {!testResult.ok && testResult.error && (
              <p className="mt-1 break-words font-mono text-xs text-red-700/90">{testResult.error}</p>
            )}
            {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
              <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                {testResult.tools.map((t) => (
                  <span key={t} className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-[11.5px] text-emerald-900 ring-1 ring-emerald-600/15">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Dialog>
  )
}
