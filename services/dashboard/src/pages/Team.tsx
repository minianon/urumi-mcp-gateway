import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleAlert,
  Ellipsis,
  Link as LinkIcon,
  Power,
  Shield,
  ShieldCheck,
  Trash,
  User as UserIcon,
  UserPlus,
  Users,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { absoluteUrl, formatDateTime, formatRelative, initials } from '../lib/format'
import { qk, useSession } from '../lib/queries'
import type { ApiKey, Role, User } from '../lib/types'
import { Page, PageHeader } from '../components/layout/PageHeader'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { CopyField } from '../components/ui/CopyButton'
import { ConfirmDialog, Dialog } from '../components/ui/Dialog'
import { EmptyState } from '../components/ui/EmptyState'
import { Field, Input, Select } from '../components/ui/Input'
import { Menu, type MenuItem } from '../components/ui/Menu'
import { TableSkeleton } from '../components/ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table'
import { Tabs } from '../components/ui/Tabs'
import { useToast } from '../components/ui/Toast'
import { Tooltip } from '../components/ui/Tooltip'
import { KeyTable } from '../components/keys/KeyTable'
import { useRevokeKey } from '../components/keys/useRevokeKey'

type Tab = 'members' | 'keys'

function InviteLinkDialog({ open, onClose, url, user }: { open: boolean; onClose: () => void; url: string; user?: { email: string } }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite link ready"
      description={
        <>
          No email is sent — share this link with <span className="font-medium text-zinc-700">{user?.email}</span> yourself
          (Slack, 1Password, …). It works once and expires.
        </>
      }
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <CopyField value={absoluteUrl(url)} />
    </Dialog>
  )
}

function InviteDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean
  onClose: () => void
  onInvited: (r: { user: User; inviteUrl: string }) => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('member')
  const queryClient = useQueryClient()
  const toast = useToast()

  const invite = useMutation({
    mutationFn: () => api.users.invite({ email: email.trim(), name: name.trim(), role }),
    onSuccess: (r) => {
      queryClient.setQueryData<User[]>(qk.users, (list) => (list ? [...list, r.user] : list))
      void queryClient.invalidateQueries({ queryKey: qk.users })
      setEmail('')
      setName('')
      setRole('member')
      onInvited(r)
    },
    onError: (err) => toast.error('Could not invite member', err),
  })

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (validEmail && name.trim()) invite.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!invite.isPending}
      title="Invite a teammate"
      description="You'll get a one-time link to share. They set their own password when they open it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="invite-form" loading={invite.isPending} disabled={!validEmail || !name.trim()}>
            Create invite link
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" htmlFor="inv-email">
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@company.com" />
        </Field>
        <Field label="Name" htmlFor="inv-name">
          <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Rivera" />
        </Field>
        <Field
          label="Role"
          htmlFor="inv-role"
          hint={
            role === 'admin'
              ? 'Admins manage servers, tool approvals, members and every API key.'
              : 'Members can use tools, chat, and manage their own API keys.'
          }
        >
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </Field>
      </form>
    </Dialog>
  )
}

const STATUS_TONE = { active: 'green', invited: 'amber', disabled: 'gray' } as const

export function TeamPage() {
  const me = useSession()
  const [tab, setTab] = useState<Tab>('members')
  const users = useQuery({ queryKey: qk.users, queryFn: api.users.list })
  const allKeys = useQuery({ queryKey: qk.allKeys, queryFn: api.keys.all })
  const revokeKey = useRevokeKey()
  const queryClient = useQueryClient()
  const toast = useToast()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [link, setLink] = useState<{ url: string; email: string } | null>(null)
  const [deleting, setDeleting] = useState<User | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)

  const replaceUser = (u: User) => queryClient.setQueryData<User[]>(qk.users, (list) => list?.map((x) => (x.id === u.id ? u : x)))

  const update = useMutation({
    mutationFn: ({ user, body }: { user: User; body: { role?: Role; status?: 'active' | 'disabled' } }) =>
      api.users.update(user.id, body),
    onSuccess: (saved, { body }) => {
      replaceUser(saved)
      toast.success(
        body.role ? `${saved.name || saved.email} is now ${body.role === 'admin' ? 'an admin' : 'a member'}` : body.status === 'disabled' ? `${saved.name || saved.email} disabled` : `${saved.name || saved.email} re-enabled`,
        body.status === 'disabled' ? 'Their API keys and sessions stop working immediately.' : undefined,
      )
    },
    onError: (err) => toast.error('Could not update member', err),
  })

  const regenerate = useMutation({
    mutationFn: (user: User) => api.users.regenerateInvite(user.id),
    onSuccess: (r, user) => setLink({ url: r.inviteUrl, email: user.email }),
    onError: (err) => toast.error('Could not regenerate invite', err),
  })

  const remove = useMutation({
    mutationFn: (user: User) => api.users.remove(user.id),
    onSuccess: (_r, user) => {
      queryClient.setQueryData<User[]>(qk.users, (list) => list?.filter((x) => x.id !== user.id))
      void queryClient.invalidateQueries({ queryKey: ['keys'] })
      toast.success(`${user.name || user.email} removed`)
      setDeleting(null)
    },
    onError: (err) => toast.error('Could not delete member', err),
  })

  const menuFor = (u: User): MenuItem[] => {
    const self = u.id === me.id
    const items: MenuItem[] = [
      u.role === 'admin'
        ? { label: 'Make member', icon: <UserIcon />, disabled: self, onSelect: () => update.mutate({ user: u, body: { role: 'member' } }) }
        : { label: 'Make admin', icon: <ShieldCheck />, disabled: self, onSelect: () => update.mutate({ user: u, body: { role: 'admin' } }) },
    ]
    if (u.status === 'invited') {
      items.push({ label: 'Regenerate invite link', icon: <LinkIcon />, onSelect: () => regenerate.mutate(u) })
    } else if (u.status === 'active') {
      items.push({ label: 'Disable', icon: <Power />, disabled: self, onSelect: () => update.mutate({ user: u, body: { status: 'disabled' } }) })
    } else {
      items.push({ label: 'Enable', icon: <Power />, onSelect: () => update.mutate({ user: u, body: { status: 'active' } }) })
    }
    items.push({ label: 'Delete', icon: <Trash />, danger: true, disabled: self, separatorBefore: true, onSelect: () => setDeleting(u) })
    return items
  }

  const list = [...(users.data ?? [])].sort(
    (a, b) => Number(b.role === 'admin') - Number(a.role === 'admin') || (a.name || a.email).localeCompare(b.name || b.email),
  )

  return (
    <Page>
      <PageHeader
        title="Team"
        description="Who can use the gateway, what role they have, and which keys they hold."
        actions={
          <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setInviteOpen(true)}>
            Invite member
          </Button>
        }
      />

      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'members', label: 'Members', count: users.data?.length },
          { id: 'keys', label: 'All API keys', count: allKeys.data?.filter((k) => !k.revokedAt).length },
        ]}
      />

      {tab === 'members' ? (
        <Card>
          {users.isPending ? (
            <TableSkeleton rows={4} cols={6} />
          ) : users.isError ? (
            <EmptyState
              icon={<CircleAlert />}
              title="Couldn't load members"
              description={errorMessage(users.error)}
              action={<Button onClick={() => users.refetch()}>Retry</Button>}
            />
          ) : list.length === 0 ? (
            <EmptyState icon={<Users />} title="No members yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Member</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Active keys</TH>
                  <TH>Last login</TH>
                  <TH className="w-px" />
                </tr>
              </THead>
              <TBody>
                {list.map((u) => (
                  <TR key={u.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-semibold text-zinc-600 ring-1 ring-zinc-200">
                          {initials(u.name, u.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium text-zinc-900">
                            {u.name || u.email}
                            {u.id === me.id && <span className="text-xs font-normal text-zinc-400">(you)</span>}
                          </p>
                          <p className="truncate text-xs text-zinc-500">{u.email}</p>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      {u.role === 'admin' ? (
                        <Badge tone="indigo" icon={<Shield className="size-3" />}>
                          Admin
                        </Badge>
                      ) : (
                        <Badge tone="gray">Member</Badge>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[u.status] ?? 'gray'} dot>
                        {u.status === 'invited' ? 'Invited' : u.status === 'active' ? 'Active' : 'Disabled'}
                      </Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{u.activeKeyCount}</TD>
                    <TD>
                      {u.lastLoginAt ? (
                        <Tooltip content={formatDateTime(u.lastLoginAt)}>
                          <span>{formatRelative(u.lastLoginAt)}</span>
                        </Tooltip>
                      ) : (
                        <span className="text-zinc-400">Never</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Menu label={`Actions for ${u.name || u.email}`} trigger={<Ellipsis className="size-4" />} items={menuFor(u)} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          {allKeys.isError ? (
            <EmptyState
              icon={<CircleAlert />}
              title="Couldn't load keys"
              description={errorMessage(allKeys.error)}
              action={<Button onClick={() => allKeys.refetch()}>Retry</Button>}
            />
          ) : (
            <KeyTable keys={allKeys.data} loading={allKeys.isPending} showOwner onRevoke={setRevoking} />
          )}
        </Card>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(r) => {
          setInviteOpen(false)
          setLink({ url: r.inviteUrl, email: r.user.email })
        }}
      />
      <InviteLinkDialog open={link !== null} onClose={() => setLink(null)} url={link?.url ?? ''} user={link ?? undefined} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        pending={remove.isPending}
        title={`Delete ${deleting?.name || deleting?.email || 'member'}?`}
        confirmLabel="Delete member"
        description="Their account and all their API keys are removed immediately. Audit log entries are kept."
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        pending={revokeKey.isPending}
        title="Revoke API key?"
        confirmLabel="Revoke key"
        description={
          <>
            <span className="font-medium text-zinc-700">{revoking?.name}</span> belonging to{' '}
            <span className="font-medium text-zinc-700">{revoking?.user?.email ?? 'this user'}</span> will stop working
            immediately.
          </>
        }
        onConfirm={() => revoking && revokeKey.mutate(revoking, { onSuccess: () => setRevoking(null) })}
      />
    </Page>
  )
}
