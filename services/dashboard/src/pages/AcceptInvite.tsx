import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as LinkIcon } from 'lucide-react'
import { ApiError, api, errorMessage } from '../lib/api'
import { qk } from '../lib/queries'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Input'
import { Skeleton } from '../components/ui/Skeleton'
import { AuthShell, FormError } from './Login'

const MIN_PASSWORD = 8

export function AcceptInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)

  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.auth.invite(token),
    retry: false,
    enabled: token.length > 0,
  })

  const accept = useMutation({
    mutationFn: () => api.auth.acceptInvite(token, password),
    onSuccess: ({ user }) => {
      queryClient.clear()
      queryClient.setQueryData(qk.me, user)
      navigate('/', { replace: true })
    },
  })

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && password !== confirm
  const valid = password.length >= MIN_PASSWORD && password === confirm

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (valid) accept.mutate()
  }

  if (invite.isError) {
    const notFound = invite.error instanceof ApiError && invite.error.status === 404
    return (
      <AuthShell title={notFound ? 'This invite link is no longer valid' : 'Could not load invite'}>
        <div className="space-y-4 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
            <LinkIcon className="size-5" />
          </div>
          <p className="text-sm text-zinc-600">
            {notFound
              ? 'Invite links expire and can only be used once. Ask your admin to generate a new one.'
              : errorMessage(invite.error)}
          </p>
          <Link to="/login" className="inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500">
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Join your team on Urumi"
      subtitle={invite.data ? `Set a password for ${invite.data.email}` : 'Loading your invite…'}
    >
      {invite.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2.5 ring-1 ring-inset ring-zinc-200/70">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900">{invite.data.name || invite.data.email}</p>
              <p className="truncate text-xs text-zinc-500">{invite.data.email}</p>
            </div>
            <Badge tone={invite.data.role === 'admin' ? 'indigo' : 'gray'}>{invite.data.role}</Badge>
          </div>
          {accept.error && <FormError>{errorMessage(accept.error)}</FormError>}
          {/* hidden username field helps password managers save the right account */}
          <input type="email" autoComplete="username" value={invite.data.email} readOnly hidden />
          <Field
            label="Password"
            htmlFor="new-password"
            hint={`At least ${MIN_PASSWORD} characters.`}
            error={tooShort && touched ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
          >
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={tooShort && touched}
              autoFocus
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm-password" error={mismatch ? 'Passwords do not match.' : undefined}>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={mismatch}
            />
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={accept.isPending} disabled={!valid}>
            Create account &amp; sign in
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
